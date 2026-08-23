import type {
  ComponentType,
  CSSProperties,
  ReactNode,
  RefObject,
} from 'react';
import type * as CarbonIconsRuntime from '@carbon/icons-react';
import type * as CarbonRuntime from '@carbon/react';
import type * as ReactRuntime from 'react';
import type * as ReactDomRuntime from 'react-dom';
import type * as RouterRuntime from 'react-router-dom';

import type {
  PluginId,
  PluginPermissionV1,
  PluginSlotIdV1,
  SemVer,
} from './common.js';
import type {
  PluginContributionAvailabilityEntryV1,
  PluginContributionAvailabilityReasonCodeV1,
} from './availability.js';

export interface PluginRoutePropsV1 {
  params: Readonly<Record<string, string>>;
  tenantRef?: string;
}

export interface PluginRouteContributionV1 {
  id: string;
  scope: 'root' | 'tenant';
  relativePath: string;
  component: ComponentType<PluginRoutePropsV1>;
  requiredPermission?: PluginPermissionV1;
}

export interface PluginNavigationContributionV1 {
  id: string;
  label: string;
  routeId: string;
  section: 'main' | 'tenant' | 'settings' | 'administration';
  /**
   * Host-approved product area. When omitted, the host keeps the contribution
   * in its generic Plugins fallback so older plugins remain compatible.
   */
  destination?: 'voyager' | 'operations' | 'tenant' | 'admin';
  /**
   * Optional host vocabulary used as a placement hint. Plugins cannot create
   * arbitrary navigation parents.
   */
  parentDestination?:
    | 'mission-control'
    | 'engines'
    | 'platform-settings'
    | 'plugins';
  order?: number;
  icon?: ComponentType<{ size?: number }>;
}

export interface PluginSettingsContributionV1 {
  id: string;
  label: string;
  routeId: string;
  scope: 'tenant' | 'deployment';
  order?: number;
}

export type PluginSerializableValueV1 =
  | null
  | boolean
  | number
  | string
  | readonly PluginSerializableValueV1[]
  | { readonly [key: string]: PluginSerializableValueV1 };

/**
 * Safe, serializable identity of the object that launched a contextual flow.
 * Product-specific payloads, variables, stack traces, and credentials do not
 * belong here; plugins retrieve any additionally authorized data through a
 * declared broker operation.
 */
export interface PluginContextualFlowSourceContextV1 {
  schemaVersion: 1;
  objectType:
    | 'engine'
    | 'process-instance'
    | 'incident'
    | 'failed-job'
    | 'batch';
  objectRef: string;
  engineRef?: string;
  tenantRef?: string;
  displayName?: string;
  product?: string;
  productVersion?: string;
}

/** Host vocabulary needed to restore the surface that launched the flow. */
export interface PluginContextualFlowReturnContextV1 {
  schemaVersion: 1;
  surface:
    | 'engine-detail'
    | 'process-instance'
    | 'incident-detail'
    | 'failed-job-detail'
    | 'batch-detail'
    | 'plugin-route';
  objectRef?: string;
}

export type PluginContextualFlowLifecycleReasonV1 =
  | 'opened'
  | 'closed'
  | 'cancelled'
  | 'replaced'
  | 'completed'
  | 'returned';

export interface PluginContextualFlowRenderContextV1 {
  sourceContext: Readonly<PluginContextualFlowSourceContextV1>;
  returnContext?: Readonly<PluginContextualFlowReturnContextV1>;
  close(): void;
  back(): void;
  complete(): void;
}

export interface PluginContextualFlowRequestV1 {
  /** Must be namespaced by the active plugin ID. */
  flowId: string;
  title: string;
  sourceContext: PluginContextualFlowSourceContextV1;
  returnContext?: PluginContextualFlowReturnContextV1;
  backLabel?: string;
  render(context: PluginContextualFlowRenderContextV1): ReactNode;
  onLifecycle?(event: {
    reason: PluginContextualFlowLifecycleReasonV1;
    flowId: string;
  }): void;
}

/**
 * A controller is bound to one plugin contribution by the host. Ownership is
 * enforced by the host, so one plugin cannot replace or close another
 * plugin's active flow.
 */
export interface PluginContextualFlowControllerV1 {
  open(request: PluginContextualFlowRequestV1): boolean;
  close(reason?: 'closed' | 'cancelled' | 'completed'): void;
  back(): void;
}

export interface PluginSlotBaseContextV1 {
  schemaVersion: 1;
  disabled: boolean;
  tenantRef?: string;
  /** Optional host-approved display label; never an unrestricted payload. */
  displayName?: string;
  /** Optional normalized product family such as operaton or enterpriseglue. */
  product?: string;
  /** Optional installed product version visible to the current operator. */
  productVersion?: string;
  contextualFlow?: PluginContextualFlowControllerV1;
}

export interface MissionControlIncidentActionContextV1
  extends PluginSlotBaseContextV1 {
  slot: 'mission-control.incident.actions.v1';
  engineRef: string;
  incidentRef: string;
}

export interface MissionControlFailedJobActionContextV1
  extends PluginSlotBaseContextV1 {
  slot: 'mission-control.failed-job.actions.v1';
  engineRef: string;
  failedJobRef: string;
}

export interface MissionControlProcessInstanceActionContextV1
  extends PluginSlotBaseContextV1 {
  slot: 'mission-control.process-instance.actions.v1';
  engineRef: string;
  processInstanceRef: string;
}

export interface MissionControlEngineActionContextV1
  extends PluginSlotBaseContextV1 {
  slot: 'mission-control.engine.actions.v1';
  engineRef: string;
  /**
   * A safe projection of the host's most recent connection check. It contains
   * no endpoint, credential, error payload, or timing data. Plugins can use it
   * only to make a contextual action more helpful (for example, offering to
   * analyse a disconnected engine).
   */
  engineConnection?: 'connected' | 'disconnected' | 'unknown';
}

export interface MissionControlEngineTabContextV1
  extends PluginSlotBaseContextV1 {
  slot: 'mission-control.engine.tabs.v1';
  engineRef: string;
  selected: boolean;
}

export interface TenantSettingsPageContextV1 extends PluginSlotBaseContextV1 {
  slot: 'settings.tenant.pages.v1';
  tenantRef: string;
}

export interface DeploymentSettingsPageContextV1
  extends PluginSlotBaseContextV1 {
  slot: 'settings.deployment.pages.v1';
}

export interface GlobalHeaderActionContextV1 extends PluginSlotBaseContextV1 {
  slot: 'global.header.actions.v1';
  theme: 'white' | 'g10' | 'g90' | 'g100';
}

export interface PluginSlotContextMapV1 {
  'mission-control.incident.actions.v1': MissionControlIncidentActionContextV1;
  'mission-control.failed-job.actions.v1': MissionControlFailedJobActionContextV1;
  'mission-control.process-instance.actions.v1': MissionControlProcessInstanceActionContextV1;
  'mission-control.engine.actions.v1': MissionControlEngineActionContextV1;
  'mission-control.engine.tabs.v1': MissionControlEngineTabContextV1;
  'settings.tenant.pages.v1': TenantSettingsPageContextV1;
  'settings.deployment.pages.v1': DeploymentSettingsPageContextV1;
  'global.header.actions.v1': GlobalHeaderActionContextV1;
}

export type PluginSlotContributionV1 = {
  [Slot in PluginSlotIdV1]: {
    id: string;
    slot: Slot;
    order?: number;
    component: ComponentType<PluginSlotContextMapV1[Slot]>;
  };
}[PluginSlotIdV1];

export interface FrontendContributionSetV1 {
  routes?: PluginRouteContributionV1[];
  navigation?: PluginNavigationContributionV1[];
  slots?: PluginSlotContributionV1[];
  settings?: PluginSettingsContributionV1[];
}

export interface PluginPageLayoutPropsV1 {
  children?: ReactNode;
  /**
   * `main` is the default for a route contribution. Nested surfaces must use
   * `section` or `div` so the rendered document retains one main landmark.
   */
  as?: 'main' | 'section' | 'div';
  maxWidth?: 'content' | 'wide' | 'full';
  labelledBy?: string;
  className?: string;
  style?: CSSProperties;
}

export interface PluginPageHeaderPropsV1 {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  icon?: ComponentType<{
    size?: number;
    'aria-hidden'?: boolean;
  }>;
  actions?: ReactNode;
  headingId?: string;
}

export interface PluginConfirmModalPropsV1 {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  onClose(): void;
  onConfirm(): void | Promise<void>;
  danger?: boolean;
  busy?: boolean;
  busyLabel?: string;
  /**
   * Carbon returns focus here after cancel, Escape, or completion. Supplying
   * the launcher reference is required when the trigger remains mounted.
   */
  launcherButtonRef?: RefObject<HTMLButtonElement | null>;
}

/**
 * Additive host-rendered primitives. The property is optional so an SDK 0.1.x
 * plugin continues to activate on an older compatible host. A plugin using
 * these helpers must feature-detect them and retain an accessible fallback
 * until its declared minimum host version guarantees the surface.
 */
export interface PluginUiPrimitivesV1 {
  PageLayout: ComponentType<PluginPageLayoutPropsV1>;
  PageHeader: ComponentType<PluginPageHeaderPropsV1>;
  ConfirmModal: ComponentType<PluginConfirmModalPropsV1>;
}

export interface FrontendPluginHostContextV1 {
  plugin: {
    id: PluginId;
    version: SemVer;
    enabledTenantRef?: string;
  };
  api: {
    request<T>(
      operationId: string,
      request?: {
        method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
        path?: string;
        body?: unknown;
        signal?: AbortSignal;
      },
    ): Promise<T>;
    stream?<T>(
      operationId: string,
      request: {
        method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
        path?: string;
        body?: unknown;
        signal?: AbortSignal;
        onEvent(event: {
          data: T;
          event?: string;
          id?: string;
        }): void;
      },
    ): Promise<void>;
  };
  /**
   * Read-only server-derived snapshot. Reading it never performs network I/O.
   * Undeclared/unknown IDs are unavailable and cannot grant authorization.
   */
  availability: {
    get(contributionId: string): Readonly<PluginContributionAvailabilityEntryV1>;
    isAvailable(contributionId: string): boolean;
    reason(
      contributionId: string,
    ): PluginContributionAvailabilityReasonCodeV1;
  };
  navigation: {
    toContribution(contributionId: string, params?: Record<string, string>): void;
    /**
     * Returns to the browser location that opened a contextual plugin surface.
     * This intentionally has no arbitrary-path argument: plugins cannot use
     * the host navigation API to discover or compose privileged host routes.
     */
    back?(): void;
  };
  notifications: {
    show(input: {
      kind: 'success' | 'info' | 'warning' | 'error';
      title: string;
      subtitle?: string;
    }): void;
  };
  telemetry: {
    event(
      name: string,
      attributes?: Record<string, string | number | boolean>,
    ): void;
  };
  ui: {
    theme: 'white' | 'g10' | 'g90' | 'g100';
    locale: string;
    direction?: 'ltr' | 'rtl';
    density: 'normal' | 'compact';
    prefersReducedMotion?: boolean;
    primitives?: Readonly<PluginUiPrimitivesV1>;
  };
  /**
   * Exact host-owned singleton runtimes.
   *
   * Plugin builds must treat these packages as host externals. The host
   * compatibility resolver requires exact versions before activation, and
   * private plugin build tooling must prove React/Carbon are not bundled.
   */
  shared: {
    react: Readonly<typeof ReactRuntime>;
    reactDom: Readonly<typeof ReactDomRuntime>;
    router: Readonly<typeof RouterRuntime>;
    carbon: Readonly<typeof CarbonRuntime>;
    carbonIcons: Readonly<typeof CarbonIconsRuntime>;
  };
}

export interface PluginFrontendModuleV1 {
  apiVersion: 'frontend.plugin.enterpriseglue.io/v1';
  pluginId: PluginId;
  version: SemVer;
  activate(
    context: FrontendPluginHostContextV1,
  ): FrontendContributionSetV1 | Promise<FrontendContributionSetV1>;
  deactivate?(): void | Promise<void>;
}
