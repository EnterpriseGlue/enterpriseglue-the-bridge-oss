import type { ComponentType, ReactNode, CSSProperties } from 'react';

export type EnterpriseAuthzResourceType =
  | 'platform'
  | 'tenant'
  | 'project'
  | 'engine'
  | 'engine_set'
  | 'project_engine_target'
  | 'api_client'
  | 'sso_mapping'
  | 'sidecar'
  | 'external_engine_system';

export type EnterpriseAuthzBackendRouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface EnterpriseAuthzBackendRoute {
  method: EnterpriseAuthzBackendRouteMethod;
  path: string;
  actionId?: string;
}

export interface EnterpriseRouteAuthz {
  /** Action id required to enter this extension route. */
  actionId?: string;
  /** Any matching action allows route entry. */
  actionIds?: string[];
  /** Static resource type used for action evaluation. Defaults to the action resource type. */
  actionResourceType?: EnterpriseAuthzResourceType;
  /** Optional static resource id used for action evaluation. */
  actionResourceId?: string | null;
  /** Optional backend/OpenAPI manifest rows this route depends on. */
  backendRoutes?: EnterpriseAuthzBackendRoute[];
}

export type EnterpriseRouteHandle = Record<string, unknown> & {
  enterpriseglueAuthz?: EnterpriseRouteAuthz;
};

export type EnterpriseRoute = {
  path?: string;
  index?: boolean;
  element?: unknown;
  authz?: EnterpriseRouteAuthz;
  handle?: EnterpriseRouteHandle;
  children?: EnterpriseRoute[];
};

export interface ComponentOverride {
  /** Stable extension point name (for example: `engines-page`). */
  name: string;
  /** UI component rendered by the host at the named extension point. */
  component: ComponentType<Record<string, unknown>>;
}

export interface FeatureOverride {
  /** Host feature flag identifier (for example: `multiTenant`). */
  flag: string;
  enabled: boolean;
}

export interface EnterpriseNavItem {
  id: string;
  label: string;
  path: string;
  order?: number;
  actionId?: string;
  actionIds?: string[];
  actionResourceType?: EnterpriseAuthzResourceType;
  actionResourceId?: string | null;
  requiredPermission?: string;
  requiredPermissions?: string[];
  requiresTenantAdmin?: boolean;
  requiredRole?: 'admin' | 'tenant_admin' | 'member';
  section?: 'main' | 'admin' | 'tenant-admin' | 'settings' | 'tenant';
  tenantOnly?: boolean;
  [key: string]: unknown;
}

export interface EnterpriseMenuItem {
  id: string;
  label: string;
  order?: number;
  actionId?: string;
  actionIds?: string[];
  actionResourceType?: EnterpriseAuthzResourceType;
  actionResourceId?: string | null;
  requiredPermission?: string;
  requiredPermissions?: string[];
  requiresTenantAdmin?: boolean;
  requiredRole?: 'admin' | 'tenant_admin' | 'member';
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// FrontendPluginContext — shared utilities provided by the OSS host
// ---------------------------------------------------------------------------

/** HTTP API client provided by the host. */
export interface PluginApiClient {
  get<T>(url: string, params?: Record<string, any>, options?: RequestInit): Promise<T>;
  post<T>(url: string, body?: any, options?: RequestInit): Promise<T>;
  put<T>(url: string, body?: any, options?: RequestInit): Promise<T>;
  patch<T>(url: string, body?: any, options?: RequestInit): Promise<T>;
  delete<T = void>(url: string, options?: RequestInit): Promise<T>;
  getBlob(url: string, params?: Record<string, any>, options?: RequestInit): Promise<Blob>;
}

/** Typed API error thrown by `PluginApiClient`. */
export interface PluginApiErrorClass {
  new (status: number, statusText: string, message: string): Error & { status: number; statusText: string };
}

/** Parsed API error shape. */
export interface ParsedApiError {
  message: string;
  hint?: string;
  field?: string;
  payload?: any;
  status?: number;
}

/** API error utilities provided by the host. */
export interface PluginApiErrorUtils {
  ApiError: PluginApiErrorClass;
  parseApiError(error: unknown, fallbackMessage?: string): ParsedApiError;
  getUiErrorMessage(error: unknown, fallbackMessage?: string): string;
  getErrorMessageFromResponse(response: Response): Promise<string>;
}

/** Props for the host PageHeader component. */
export interface PageHeaderProps {
  icon: ComponentType<any>;
  title: string;
  subtitle?: string;
  gradient?: [string, string];
  actions?: ReactNode;
}

/** Props for the host PageLayout component. */
export interface PageLayoutProps {
  children: ReactNode;
  padding?: string;
  style?: CSSProperties;
}

/** Props for the host ConfirmModal component. */
export interface ConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  warning?: boolean;
  busy?: boolean;
  showWarning?: boolean;
  warningMessage?: string;
}

/** Toast notification input. */
export interface ToastInput {
  kind: 'success' | 'info' | 'warning' | 'error';
  title: string;
  subtitle?: string;
  timeout?: number;
}

/** Auth context value provided by the host. */
export interface PluginAuthContext {
  user: Record<string, any> | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login(credentials: any): Promise<any>;
  logout(): Promise<void>;
  refreshUser(): Promise<void>;
}

/** Shared utilities the OSS host passes to the enterprise frontend plugin. */
export interface FrontendPluginContext {
  api: {
    client: PluginApiClient;
    errors: PluginApiErrorUtils;
  };
  components: {
    PageHeader: ComponentType<PageHeaderProps>;
    PageLayout: ComponentType<PageLayoutProps>;
    PAGE_GRADIENTS: Record<string, [string, string]>;
    ConfirmModal: ComponentType<ConfirmModalProps>;
    InviteMemberModal: ComponentType<any>;
  };
  hooks: {
    useAuth(): PluginAuthContext;
    useModal<T = any>(): { isOpen: boolean; data: T | undefined; openModal(data?: T): void; closeModal(): void };
    useToast(): { notify(toast: ToastInput): void };
  };
  runtime?: {
    /** Host React instance. New hosts provide it; legacy plugin contexts remain valid. */
    react: typeof import('react');
  };
}

export interface EnterpriseFrontendPlugin {
  routes?: EnterpriseRoute[];
  tenantRoutes?: EnterpriseRoute[];
  navItems?: EnterpriseNavItem[];
  menuItems?: EnterpriseMenuItem[];
  componentOverrides?: ComponentOverride[];
  featureOverrides?: FeatureOverride[];
  /** Called by the host after loading to provide shared utilities. */
  init?(context: FrontendPluginContext): void;
  /** @deprecated Unsupported by OSS host; keep EE UI slot extensions in `componentOverrides`. */
  headerSlots?: never;
  /** @deprecated Unsupported by OSS host; use `navItems` instead. */
  sidebarItems?: never;
}

/** Deployment-owned, mandatory UI module descriptor from same-origin runtime config. */
export interface TrustedSystemFrontendModuleDescriptorV1 {
  ownerId: string;
  entryPath: string;
  integrity: `sha256-${string}`;
  required?: boolean;
}

/**
 * A trusted system module is distinct from a tenant-optional marketplace
 * plugin. It can add routes/navigation but cannot replace host features or
 * components.
 */
export interface TrustedSystemFrontendModuleV1 {
  ownerId: string;
  activate(context: FrontendPluginContext): EnterpriseFrontendPlugin | Promise<EnterpriseFrontendPlugin>;
}

export type RegisterTrustedSystemFrontendModuleV1 = (module: TrustedSystemFrontendModuleV1) => void;
