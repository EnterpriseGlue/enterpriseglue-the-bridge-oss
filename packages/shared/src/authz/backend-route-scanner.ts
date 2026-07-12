import { listAuthzActions } from './permission-actions.js';
import { listAuthzRouteExemptions, type AuthzRouteExemption } from './route-exemptions.js';
import { normalizeAuthzRoutePath } from './route-inventory.js';

const ROUTE_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);
const AUTH_MIDDLEWARE_PATTERNS = [
  'requireAction',
  'requireApiClientAction',
  'requireApiClientScope',
  'requireApiDeploymentEligibility',
  'requireAnyPermission',
  'requireAuth',
  'requireDeployPermission',
  'requireEngineAccess',
  'requireEngineDeployer',
  'requireEngineReadOrWrite',
  'requireInvitationCreateAction',
  'requirePermission',
  'requirePlatformAdmin',
  'requireProjectAccess',
  'requireProjectRole',
];

export interface BackendRouteScanSource {
  filePath: string;
  content: string;
}

export interface BackendRouteScanEntry {
  filePath: string;
  line: number;
  method: string;
  route: string;
  normalizedRoute: string;
  authenticated: boolean;
  authMiddleware: string[];
  registeredActionIds: string[];
  exemption?: AuthzRouteExemption | null;
}

export interface BackendRouteScanResult {
  routes: BackendRouteScanEntry[];
  authenticatedRoutes: BackendRouteScanEntry[];
  registeredAuthenticatedRoutes: BackendRouteScanEntry[];
  exemptAuthenticatedRoutes: BackendRouteScanEntry[];
  coveredAuthenticatedRoutes: BackendRouteScanEntry[];
  uncoveredAuthenticatedRoutes: BackendRouteScanEntry[];
  unregisteredAuthenticatedRoutes: BackendRouteScanEntry[];
}

function routeKey(method: string, route: string): string {
  return `${method.trim().toUpperCase()} ${normalizeAuthzRoutePath(route)}`;
}

function lineNumberAt(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (content.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function skipString(content: string, index: number): number {
  const quote = content[index];
  let i = index + 1;
  while (i < content.length) {
    const ch = content[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    i += 1;
  }
  return content.length;
}

function skipTemplate(content: string, index: number): number {
  let i = index + 1;
  while (i < content.length) {
    const ch = content[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '`') return i + 1;
    i += 1;
  }
  return content.length;
}

function skipComment(content: string, index: number): number {
  if (content[index + 1] === '/') {
    const nextLine = content.indexOf('\n', index + 2);
    return nextLine === -1 ? content.length : nextLine + 1;
  }
  if (content[index + 1] === '*') {
    const end = content.indexOf('*/', index + 2);
    return end === -1 ? content.length : end + 2;
  }
  return index + 1;
}

function findMatchingParen(content: string, openParenIndex: number): number {
  let depth = 0;
  let i = openParenIndex;
  while (i < content.length) {
    const ch = content[i];
    if (ch === '"' || ch === "'") {
      i = skipString(content, i);
      continue;
    }
    if (ch === '`') {
      i = skipTemplate(content, i);
      continue;
    }
    if (ch === '/' && (content[i + 1] === '/' || content[i + 1] === '*')) {
      i = skipComment(content, i);
      continue;
    }
    if (ch === '(') depth += 1;
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

function readFirstStringArgument(callText: string): string | null {
  let i = 1;
  while (i < callText.length && /\s/.test(callText[i])) i += 1;
  const quote = callText[i];
  if (quote !== '"' && quote !== "'" && quote !== '`') return null;

  let value = '';
  i += 1;
  while (i < callText.length) {
    const ch = callText[i];
    if (ch === '\\') {
      const next = callText[i + 1];
      value += typeof next === 'string' ? next : '';
      i += 2;
      continue;
    }
    if (ch === quote) return value;
    value += ch;
    i += 1;
  }

  return null;
}

function authMiddlewareNames(callText: string): string[] {
  return AUTH_MIDDLEWARE_PATTERNS.filter((name) => new RegExp(`\\b${name}\\b`).test(callText));
}

interface AuthenticatedUseScope {
  index: number;
  prefix: string | null;
}

function findAuthenticatedUseScopes(content: string): AuthenticatedUseScope[] {
  const scopes: AuthenticatedUseScope[] = [];
  const useCallPattern = /\b[A-Za-z_$][\w$]*\s*\.\s*use\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = useCallPattern.exec(content))) {
    const openParenIndex = content.indexOf('(', match.index);
    const end = findMatchingParen(content, openParenIndex);
    if (end === -1) continue;

    const callText = content.slice(openParenIndex, end + 1);
    if (!authMiddlewareNames(callText).length) continue;

    scopes.push({
      index: match.index,
      prefix: readFirstStringArgument(callText),
    });
  }
  return scopes.sort((left, right) => left.index - right.index);
}

function isAuthenticatedByUseScope(routeIndex: number, route: string, scopes: AuthenticatedUseScope[]): boolean {
  return scopes.some((scope) => {
    if (scope.index > routeIndex) return false;
    if (!scope.prefix) return true;
    return normalizeAuthzRoutePath(route).startsWith(normalizeAuthzRoutePath(scope.prefix));
  });
}

function buildRegisteredActionIndex(): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const action of listAuthzActions()) {
    for (const route of action.routes || []) {
      const key = routeKey(route.method, route.route);
      const entries = index.get(key) || [];
      entries.push(action.actionId);
      index.set(key, entries);
    }
  }
  return index;
}

function buildExemptionIndex(): Map<string, AuthzRouteExemption> {
  const index = new Map<string, AuthzRouteExemption>();
  for (const exemption of listAuthzRouteExemptions()) {
    index.set(routeKey(exemption.method, exemption.route), exemption);
  }
  return index;
}

export function scanBackendAuthzRoutes(sources: BackendRouteScanSource[]): BackendRouteScanResult {
  const registeredActionIndex = buildRegisteredActionIndex();
  const exemptionIndex = buildExemptionIndex();
  const routes: BackendRouteScanEntry[] = [];
  const routeCallPattern = /\b[A-Za-z_$][\w$]*\s*\.\s*(get|post|put|patch|delete)\s*\(/g;

  for (const source of sources) {
    const useScopes = findAuthenticatedUseScopes(source.content);
    let match: RegExpExecArray | null;
    while ((match = routeCallPattern.exec(source.content))) {
      const method = match[1].toUpperCase();
      if (!ROUTE_METHODS.has(match[1])) continue;

      const openParenIndex = source.content.indexOf('(', match.index);
      const end = findMatchingParen(source.content, openParenIndex);
      if (end === -1) continue;

      const callText = source.content.slice(openParenIndex, end + 1);
      const route = readFirstStringArgument(callText);
      if (!route || !route.startsWith('/')) continue;

      const callAuthMiddleware = authMiddlewareNames(callText);
      const authenticated = callAuthMiddleware.length > 0 || isAuthenticatedByUseScope(match.index, route, useScopes);
      const normalizedRoute = normalizeAuthzRoutePath(route);
      const registeredActionIds = registeredActionIndex.get(routeKey(method, route)) || [];
      const exemption = exemptionIndex.get(routeKey(method, route)) || null;
      routes.push({
        filePath: source.filePath,
        line: lineNumberAt(source.content, match.index),
        method,
        route,
        normalizedRoute,
        authenticated,
        authMiddleware: callAuthMiddleware,
        registeredActionIds,
        exemption,
      });
    }
  }

  const authenticatedRoutes = routes.filter((route) => route.authenticated);
  const registeredAuthenticatedRoutes = authenticatedRoutes.filter((route) => route.registeredActionIds.length > 0);
  const exemptAuthenticatedRoutes = authenticatedRoutes.filter((route) =>
    route.registeredActionIds.length === 0 && Boolean(route.exemption)
  );
  const coveredAuthenticatedRoutes = authenticatedRoutes.filter((route) =>
    route.registeredActionIds.length > 0 || Boolean(route.exemption)
  );
  const uncoveredAuthenticatedRoutes = authenticatedRoutes.filter((route) =>
    route.registeredActionIds.length === 0 && !route.exemption
  );

  return {
    routes,
    authenticatedRoutes,
    registeredAuthenticatedRoutes,
    exemptAuthenticatedRoutes,
    coveredAuthenticatedRoutes,
    uncoveredAuthenticatedRoutes,
    unregisteredAuthenticatedRoutes: uncoveredAuthenticatedRoutes,
  };
}
