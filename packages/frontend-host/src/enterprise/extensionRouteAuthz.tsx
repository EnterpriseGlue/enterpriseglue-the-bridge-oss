import React from 'react';
import type { RouteObject } from 'react-router-dom';
import {
  getAuthzActionDefinition,
} from '@enterpriseglue/shared/authz/permission-actions.js';
import { evaluateActionSnapshot, UnauthorizedEmptyState, type ActionResource } from '../shared/auth/guards';
import { useAuth } from '../shared/hooks/useAuth';
import type {
  EnterpriseExtensionRoute,
  ExtensionAuthzBackendRoute,
  ExtensionRouteAuthzMetadata,
} from './extensionRegistry';

export type ExtensionRouteScope = 'root' | 'tenant';

export type ExtensionRouteAuthzIssueCode =
  | 'route.missing-authz'
  | 'route.unknown-action'
  | 'route.backend-invalid'
  | 'route.backend-unknown-action';

export interface ExtensionRouteAuthzIssue {
  code: ExtensionRouteAuthzIssueCode;
  scope: ExtensionRouteScope;
  path: string;
  actionId?: string;
  message: string;
}

export interface PrepareExtensionRoutesOptions {
  scope: ExtensionRouteScope;
  warn?: boolean;
}

function routeDisplayPath(parentPath: string, route: EnterpriseExtensionRoute): string {
  if (route.index) return `${parentPath || '/'} (index)`;
  const segment = String(route.path || '').trim();
  if (!segment) return parentPath || '/';
  if (segment.startsWith('/')) return segment;
  const prefix = parentPath && parentPath !== '/' ? parentPath : '';
  return `${prefix}/${segment}`.replace(/\/+/g, '/');
}

function routeHasEntryElement(route: EnterpriseExtensionRoute): boolean {
  return Boolean(route.index || route.element);
}

export function getExtensionRouteAuthz(route: EnterpriseExtensionRoute): ExtensionRouteAuthzMetadata | undefined {
  return route.authz ?? route.handle?.enterpriseglueAuthz;
}

export function getExtensionAuthzActionIds(authz: ExtensionRouteAuthzMetadata | undefined): string[] {
  if (!authz) return [];
  return [
    ...(authz.actionId ? [authz.actionId] : []),
    ...(Array.isArray(authz.actionIds) ? authz.actionIds : []),
  ].filter(Boolean);
}

function actionResource(
  authz: ExtensionRouteAuthzMetadata,
  actionId: string,
  snapshot: ReturnType<typeof useAuth>['permissions']
): ActionResource | undefined {
  const action = getAuthzActionDefinition(actionId);
  const resourceType = authz.actionResourceType ?? action?.resourceType;
  const resourceId = typeof authz.actionResourceId !== 'undefined'
    ? authz.actionResourceId
    : resourceType === 'tenant'
      ? snapshot?.tenant?.resourceId
      : undefined;
  if (!resourceType && typeof resourceId === 'undefined') return undefined;
  return {
    type: resourceType ?? 'platform',
    id: resourceId ?? null,
  };
}

function validateBackendRoute(
  backendRoute: ExtensionAuthzBackendRoute,
  authzActionIds: string[],
  scope: ExtensionRouteScope,
  routePath: string
): ExtensionRouteAuthzIssue[] {
  const issues: ExtensionRouteAuthzIssue[] = [];
  const method = String(backendRoute.method || '').trim().toUpperCase();
  const path = String(backendRoute.path || '').trim();

  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method) || !path.startsWith('/')) {
    issues.push({
      code: 'route.backend-invalid',
      scope,
      path: routePath,
      message: `Extension route ${routePath} has invalid backend route metadata.`,
    });
  }

  const backendActionId = backendRoute.actionId ?? authzActionIds[0];
  if (!backendActionId || !getAuthzActionDefinition(backendActionId)) {
    issues.push({
      code: 'route.backend-unknown-action',
      scope,
      path: routePath,
      actionId: backendActionId,
      message: `Extension route ${routePath} backend metadata references an unknown action id.`,
    });
  }

  return issues;
}

function validateRoute(
  route: EnterpriseExtensionRoute,
  scope: ExtensionRouteScope,
  parentPath: string
): ExtensionRouteAuthzIssue[] {
  const path = routeDisplayPath(parentPath, route);
  const authz = getExtensionRouteAuthz(route);
  const actionIds = getExtensionAuthzActionIds(authz);
  const issues: ExtensionRouteAuthzIssue[] = [];

  if (routeHasEntryElement(route) && actionIds.length === 0) {
    issues.push({
      code: 'route.missing-authz',
      scope,
      path,
      message: `Extension route ${path} must declare authz.actionId/actionIds or handle.enterpriseglueAuthz.`,
    });
  }

  for (const actionId of actionIds) {
    if (!getAuthzActionDefinition(actionId)) {
      issues.push({
        code: 'route.unknown-action',
        scope,
        path,
        actionId,
        message: `Extension route ${path} references unknown action id ${actionId}.`,
      });
    }
  }

  for (const backendRoute of authz?.backendRoutes || []) {
    issues.push(...validateBackendRoute(backendRoute, actionIds, scope, path));
  }

  for (const child of route.children || []) {
    issues.push(...validateRoute(child, scope, path));
  }

  return issues;
}

function validateRouteEntry(
  route: EnterpriseExtensionRoute,
  scope: ExtensionRouteScope,
  parentPath: string
): ExtensionRouteAuthzIssue[] {
  const path = routeDisplayPath(parentPath, route);
  const authz = getExtensionRouteAuthz(route);
  const actionIds = getExtensionAuthzActionIds(authz);
  const issues: ExtensionRouteAuthzIssue[] = [];

  if (routeHasEntryElement(route) && actionIds.length === 0) {
    issues.push({
      code: 'route.missing-authz',
      scope,
      path,
      message: `Extension route ${path} must declare authz.actionId/actionIds or handle.enterpriseglueAuthz.`,
    });
  }

  for (const actionId of actionIds) {
    if (!getAuthzActionDefinition(actionId)) {
      issues.push({
        code: 'route.unknown-action',
        scope,
        path,
        actionId,
        message: `Extension route ${path} references unknown action id ${actionId}.`,
      });
    }
  }

  for (const backendRoute of authz?.backendRoutes || []) {
    issues.push(...validateBackendRoute(backendRoute, actionIds, scope, path));
  }

  return issues;
}

export function validateExtensionRouteAuthz(
  routes: EnterpriseExtensionRoute[],
  scope: ExtensionRouteScope
): ExtensionRouteAuthzIssue[] {
  return routes.flatMap((route) => validateRoute(route, scope, ''));
}

function routeEntryHasValidAuthz(route: EnterpriseExtensionRoute, scope: ExtensionRouteScope, parentPath: string): boolean {
  if (!routeHasEntryElement(route)) return true;
  return validateRouteEntry(route, scope, parentPath).length === 0;
}

function ExtensionRouteAuthzBoundary({
  authz,
  routePath,
  children,
}: {
  authz: ExtensionRouteAuthzMetadata;
  routePath: string;
  children: React.ReactNode;
}) {
  const { permissions } = useAuth();
  const actionIds = getExtensionAuthzActionIds(authz);
  const decisions = actionIds.map((actionId) =>
    evaluateActionSnapshot(permissions, actionId, actionResource(authz, actionId, permissions))
  );
  const allowed = decisions.some((decision) => decision.allowed);
  if (allowed) return <>{children}</>;

  const firstDecision = decisions[0];
  return (
    <UnauthorizedEmptyState
      title="Not authorized"
      reason={firstDecision?.reason || `Missing authorization for extension route ${routePath}.`}
    />
  );
}

function warnIssues(issues: ExtensionRouteAuthzIssue[]): void {
  if (issues.length === 0) return;
  console.warn('[Enterprise] Extension route authz validation blocked routes:');
  for (const issue of issues) {
    console.warn(`- ${issue.code}: ${issue.message}`);
  }
}

function prepareRoute(
  route: EnterpriseExtensionRoute,
  options: PrepareExtensionRoutesOptions,
  parentPath: string
): RouteObject | null {
  const path = routeDisplayPath(parentPath, route);
  const childRoutes = (route.children || [])
    .map((child) => prepareRoute(child, options, path))
    .filter((child): child is RouteObject => Boolean(child));

  if (!routeEntryHasValidAuthz(route, options.scope, parentPath)) {
    if (childRoutes.length === 0) return null;
    const { element: _element, index: _index, children: _children, ...rest } = route as Record<string, unknown>;
    return { ...rest, children: childRoutes } as RouteObject;
  }

  const authz = getExtensionRouteAuthz(route);
  const element = authz && route.element
    ? (
        <ExtensionRouteAuthzBoundary authz={authz} routePath={path}>
          {route.element}
        </ExtensionRouteAuthzBoundary>
      )
    : route.element;

  return {
    ...route,
    element,
    children: childRoutes.length > 0 ? childRoutes : undefined,
  } as RouteObject;
}

export function prepareExtensionRoutes(
  routes: EnterpriseExtensionRoute[],
  options: PrepareExtensionRoutesOptions
): RouteObject[] {
  const issues = validateExtensionRouteAuthz(routes, options.scope);
  if (options.warn !== false) warnIssues(issues);

  return routes
    .map((route) => prepareRoute(route, options, ''))
    .filter((route): route is RouteObject => Boolean(route));
}
