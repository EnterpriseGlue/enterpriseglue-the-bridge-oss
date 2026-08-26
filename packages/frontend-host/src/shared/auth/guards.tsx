import {
  Children,
  cloneElement,
  Fragment,
  type CSSProperties,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useContext,
} from 'react';
import { OverflowMenu, OverflowMenuItem, type OverflowMenuItemProps, type OverflowMenuProps } from '@carbon/react';
import { Navigate, useLocation } from 'react-router-dom';
import {
  getAuthzActionDefinition,
  type AuthzResourceType,
  type AuthzUiBehavior,
  type UiAuthzDecision,
} from '@enterpriseglue/shared/authz/permission-actions.js';
import { useAuth } from '../hooks/useAuth';
import { AuthContext } from '../../contexts/AuthContext';
import {
  ACCESS_CONTROL_PLATFORM_PERMISSIONS,
  hasAnyPlatformPermission,
  hasAnyVisibleProjectPermission,
  hasEnginePermission,
  hasPlatformPermission,
  hasProjectPermission,
  hasTenantPermission,
} from './permissions';
import type { CurrentUserPermissions } from '../types/auth';

export interface ActionResource {
  type?: AuthzResourceType;
  id?: string | null;
}

export interface GuardProps {
  actionId: string;
  resource?: ActionResource;
  fallback?: ReactNode;
  children: ReactNode | ((decision: UiAuthzDecision) => ReactNode);
}

export interface GuardedRouteProps extends GuardProps {
  redirectTo?: string;
}

export interface GuardedFieldProps extends Omit<GuardProps, 'children'> {
  children?: ReactNode | ((decision: UiAuthzDecision) => ReactNode);
  value: ReactNode;
  redactedValue?: ReactNode;
}

export interface GuardedOverflowMenuItemProps extends Omit<OverflowMenuItemProps, 'disabled' | 'onClick' | 'title'> {
  decision?: UiAuthzDecision | null;
  disabled?: boolean;
  hideWhenUnavailable?: boolean;
  onClick?: OverflowMenuItemProps['onClick'];
  title?: string;
  unavailableReason?: string | null;
}

export interface WhyUnavailableLinkProps {
  decision: UiAuthzDecision;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export interface BulkActionDecisionSummary<T> {
  allowed: boolean;
  totalCount: number;
  deniedCount: number;
  firstDeniedReason: string | null;
  firstDeniedItem: T | null;
  firstDeniedDecision: UiAuthzDecision | null;
  firstDeniedDiagnosticHref: string | null;
  deniedItems: T[];
  reason: string | null;
}

export interface BulkActionDecisionSummaryOptions<T = unknown> {
  actionPastTense?: string;
  emptyReason?: string | null;
  getDiagnosticDecision?: (item: T, reason: string) => UiAuthzDecision | null | undefined;
  itemLabelSingular?: string;
  itemLabelPlural?: string;
}

function stateForBehavior(behavior: AuthzUiBehavior, allowed: boolean): UiAuthzDecision['state'] {
  if (allowed) return 'allowed';
  if (behavior === 'hide') return 'hidden';
  if (behavior === 'redact') return 'redacted';
  if (behavior === 'deny-route') return 'denied';
  return 'disabled';
}

export function evaluateActionSnapshot(
  snapshot: CurrentUserPermissions | null | undefined,
  actionId: string,
  resource?: ActionResource
): UiAuthzDecision {
  const action = getAuthzActionDefinition(actionId);
  if (!action) {
    return {
      actionId,
      resourceType: resource?.type ?? 'platform',
      resourceId: resource?.id ?? null,
      allowed: false,
      state: 'disabled',
      reason: `Unknown authorization action: ${actionId}`,
    };
  }

  const resourceType = resource?.type ?? action.resourceType;
  const resourceId = resource?.id ?? null;
  const behavior = action.ui[0]?.behavior ?? 'disable';
  let allowed = false;
  const availability = resourceType === 'platform'
    ? snapshot?.platformActionAvailability
    : resourceType === 'tenant' && resourceId && snapshot?.tenant?.resourceId === resourceId
      ? snapshot.tenant.actionAvailability
    : resourceType === 'project' && resourceId
      ? snapshot?.projects.find((item) => item.resourceId === resourceId)?.actionAvailability
      : resourceType === 'engine' && resourceId
        ? snapshot?.engines.find((item) => item.resourceId === resourceId)?.actionAvailability
        : undefined;

  const restriction = availability?.restrictions[actionId];
  const hasExplicitAvailabilityDecision = Boolean(
    availability && (availability.allowedActions.includes(actionId) || restriction),
  );
  // Runtime-enforced actions are deliberately omitted from the coarse
  // frontend availability snapshot. Only treat availability as authoritative
  // when the server explicitly allowed or restricted this action; otherwise
  // fall through to the permission snapshot and let the guarded backend route
  // enforce any runtime-resource boundary.
  if (availability && hasExplicitAvailabilityDecision) {
    allowed = availability.allowedActions.includes(actionId);
    return {
      actionId,
      permissionId: action.permissionId,
      resourceType,
      resourceId,
      allowed,
      state: stateForBehavior(behavior, allowed),
      reason: allowed
        ? 'Allowed by current server-calculated action snapshot'
        : restriction?.reason || `Missing permission ${action.permissionId}`,
      reasonCode: restriction?.reasonCode,
      managementSource: restriction?.managementSource,
      sourceRef: restriction?.sourceRef,
      diagnostics: allowed
        ? undefined
        : {
            explainUrl: '/admin/access-control?tab=effective-access',
            remediation: restriction
              ? ['Change access through the authoritative management source shown above.']
              : ['Ask a platform administrator to review effective access.'],
          },
    };
  }

  if (resourceType === 'platform') {
    allowed = hasPlatformPermission(snapshot, action.permissionId);
  } else if (resourceType === 'tenant') {
    allowed = hasTenantPermission(snapshot, resourceId, action.permissionId);
  } else if (resourceType === 'project') {
    allowed = action.actionId === 'project.projects.read' && !resourceId
      ? hasAnyVisibleProjectPermission(snapshot)
      : hasProjectPermission(snapshot, resourceId, action.permissionId);
  } else if (resourceType === 'engine') {
    allowed = hasEnginePermission(snapshot, resourceId, action.permissionId);
  }

  return {
    actionId,
    permissionId: action.permissionId,
    resourceType,
    resourceId,
    allowed,
    state: stateForBehavior(behavior, allowed),
    reason: allowed ? 'Allowed by current permission snapshot' : `Missing permission ${action.permissionId}`,
    diagnostics: allowed
      ? undefined
      : {
          explainUrl: '/admin/access-control?tab=effective-access',
          remediation: ['Ask a platform administrator to review effective access.'],
        },
  };
}

export function useActionDecision(actionId: string, resource?: ActionResource): UiAuthzDecision {
  const { permissions } = useAuth();
  return evaluateActionSnapshot(permissions, actionId, resource);
}

export function useCanAction(actionId: string, resource?: ActionResource): boolean {
  return useActionDecision(actionId, resource).allowed;
}

function renderChildren(children: GuardProps['children'], decision: UiAuthzDecision): ReactNode {
  return typeof children === 'function' ? children(decision) : children;
}

function disabledElement(children: ReactNode, decision: UiAuthzDecision): ReactNode {
  if (isValidElement(children)) {
    const element = children as ReactElement<Record<string, unknown>>;
    return cloneElement(element, {
      disabled: true,
      'aria-disabled': true,
      title: decision.reason,
    });
  }

  return (
    <span aria-disabled="true" title={decision.reason}>
      {children}
    </span>
  );
}

export function GuardedAction({ actionId, resource, fallback = null, children }: GuardProps) {
  const decision = useActionDecision(actionId, resource);
  if (decision.allowed) return <>{renderChildren(children, decision)}</>;
  if (decision.state === 'hidden') return <>{fallback}</>;
  if (decision.state === 'redacted') return <>{fallback}</>;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
      {disabledElement(renderChildren(children, decision), decision)}
      <WhyUnavailableLink decision={decision} />
    </span>
  );
}

export function GuardedMenuItem(props: GuardProps) {
  return <GuardedAction {...props} />;
}

export function getGuardedActionUnavailableReason(
  decision?: UiAuthzDecision | null,
  unavailableReason?: string | null
): string | null {
  if (unavailableReason) return unavailableReason;
  if (decision && !decision.allowed) return decision.reason || 'Action unavailable';
  return null;
}

export function summarizeBulkActionUnavailableReasons<T>(
  items: readonly T[],
  getItemUnavailableReason: (item: T) => string | null | undefined,
  options: BulkActionDecisionSummaryOptions<T> = {}
): BulkActionDecisionSummary<T> {
  const deniedItems: T[] = [];
  const deniedReasons: string[] = [];

  for (const item of items) {
    const reason = getItemUnavailableReason(item);
    if (!reason) continue;
    deniedItems.push(item);
    deniedReasons.push(reason);
  }

  if (items.length === 0) {
    return {
      allowed: !options.emptyReason,
      totalCount: 0,
      deniedCount: 0,
      firstDeniedReason: null,
      firstDeniedItem: null,
      firstDeniedDecision: null,
      firstDeniedDiagnosticHref: null,
      deniedItems,
      reason: options.emptyReason ?? null,
    };
  }

  if (deniedReasons.length === 0) {
    return {
      allowed: true,
      totalCount: items.length,
      deniedCount: 0,
      firstDeniedReason: null,
      firstDeniedItem: null,
      firstDeniedDecision: null,
      firstDeniedDiagnosticHref: null,
      deniedItems,
      reason: null,
    };
  }

  const singular = options.itemLabelSingular ?? 'resource';
  const plural = options.itemLabelPlural ?? `${singular}s`;
  const itemWord = items.length === 1 ? singular : plural;
  const firstDeniedReason = deniedReasons[0];
  const firstDeniedItem = deniedItems[0] ?? null;
  const firstDeniedDecision = firstDeniedItem
    ? options.getDiagnosticDecision?.(firstDeniedItem, firstDeniedReason) ?? null
    : null;
  const reason = options.actionPastTense
    ? `Unavailable: ${deniedReasons.length} of ${items.length} selected ${itemWord} cannot be ${options.actionPastTense}. First reason: ${firstDeniedReason}.`
    : firstDeniedReason;

  return {
    allowed: false,
    totalCount: items.length,
    deniedCount: deniedReasons.length,
    firstDeniedReason,
    firstDeniedItem,
    firstDeniedDecision,
    firstDeniedDiagnosticHref: firstDeniedDecision ? getDecisionDiagnosticHref(firstDeniedDecision) : null,
    deniedItems,
    reason,
  };
}

export function GuardedOverflowMenuItem({
  decision,
  disabled = false,
  hideWhenUnavailable = false,
  onClick,
  title,
  unavailableReason,
  requireTitle,
  ...props
}: GuardedOverflowMenuItemProps) {
  const reason = getGuardedActionUnavailableReason(decision, unavailableReason);
  const isUnavailable = disabled || Boolean(reason);
  if (hideWhenUnavailable && isUnavailable) return null;

  return (
    <OverflowMenuItem
      {...props}
      disabled={isUnavailable}
      requireTitle={requireTitle || isUnavailable}
      title={isUnavailable ? reason || title : title}
      onClick={(event) => {
        if (isUnavailable) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        onClick?.(event);
      }}
    />
  );
}

function renderGuardedOverflowMenuItem(props: GuardedOverflowMenuItemProps, key?: string | null) {
  const {
    decision,
    disabled = false,
    hideWhenUnavailable = false,
    onClick,
    title,
    unavailableReason,
    requireTitle,
    ...overflowMenuItemProps
  } = props;
  const reason = getGuardedActionUnavailableReason(decision, unavailableReason);
  const isUnavailable = disabled || Boolean(reason);
  if (hideWhenUnavailable && isUnavailable) return null;

  return (
    <OverflowMenuItem
      key={key ?? undefined}
      {...overflowMenuItemProps}
      disabled={isUnavailable}
      requireTitle={requireTitle || isUnavailable}
      title={isUnavailable ? reason || title : title}
      onClick={(event) => {
        if (isUnavailable) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        onClick?.(event);
      }}
    />
  );
}

function mapGuardedOverflowMenuChildren(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (!isValidElement(child)) return child;
    if (child.type === Fragment) {
      const fragment = child as ReactElement<{ children?: ReactNode }>;
      return <Fragment key={child.key}>{mapGuardedOverflowMenuChildren(fragment.props.children)}</Fragment>;
    }
    if (child.type === GuardedOverflowMenuItem) {
      return renderGuardedOverflowMenuItem(child.props as GuardedOverflowMenuItemProps, child.key);
    }
    return child;
  });
}

export function GuardedOverflowMenu({ children, ...props }: OverflowMenuProps) {
  return <OverflowMenu {...props}>{mapGuardedOverflowMenuChildren(children)}</OverflowMenu>;
}

export function GuardedTab(props: GuardProps) {
  return <GuardedAction {...props} />;
}

export function GuardedRoute({ actionId, resource, fallback, redirectTo = '/', children }: GuardedRouteProps) {
  const decision = useActionDecision(actionId, resource);
  const location = useLocation();
  if (decision.allowed) return <>{renderChildren(children, decision)}</>;
  if (fallback) return <>{fallback}</>;
  return <Navigate to={redirectTo} replace state={{ from: location, deniedActionId: actionId }} />;
}

export function GuardedField({ actionId, resource, fallback = null, children, value, redactedValue = '••••••' }: GuardedFieldProps) {
  const decision = useActionDecision(actionId, resource);
  if (decision.allowed) return <>{value}</>;
  if (decision.state === 'hidden') return <>{fallback}</>;
  if (typeof children === 'function') return <>{children(decision)}</>;
  return <>{redactedValue}</>;
}

export function RedactedValue({ show, value, redactedValue = '••••••' }: { show: boolean; value: ReactNode; redactedValue?: ReactNode }) {
  return <>{show ? value : redactedValue}</>;
}

export function UnauthorizedEmptyState({ title = 'Not authorized', reason }: { title?: string; reason?: ReactNode }) {
  return (
    <div role="status" style={{ padding: 'var(--spacing-6)', color: 'var(--color-text-secondary)' }}>
      <h2 style={{ margin: 0, fontSize: 'var(--text-18)' }}>{title}</h2>
      {reason ? <div style={{ marginTop: 'var(--spacing-2)' }}>{reason}</div> : null}
    </div>
  );
}

export function getDecisionDiagnosticHref(decision: UiAuthzDecision): string | null {
  const explainUrl = decision.diagnostics?.explainUrl;
  if (!explainUrl) return null;

  const [path, rawQuery = ''] = explainUrl.split('?');
  const params = new URLSearchParams(rawQuery);
  params.set('actionId', decision.actionId);
  if (decision.permissionId) params.set('permissionId', decision.permissionId);
  if (decision.resourceType) params.set('resourceType', decision.resourceType);
  if (decision.resourceId) params.set('resourceId', decision.resourceId);

  return `${path}?${params.toString()}`;
}

export function WhyUnavailableLink({ decision, children = 'Why unavailable', className, style }: WhyUnavailableLinkProps) {
  const auth = useContext(AuthContext);
  const permissions = auth?.permissions ?? null;
  if (decision.allowed || !hasAnyPlatformPermission(permissions, ACCESS_CONTROL_PLATFORM_PERMISSIONS)) return null;

  const href = getDecisionDiagnosticHref(decision);
  if (!href) return null;

  return (
    <a
      className={className}
      href={href}
      style={{ fontSize: '12px', whiteSpace: 'nowrap', ...style }}
      title={decision.reason}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </a>
  );
}
