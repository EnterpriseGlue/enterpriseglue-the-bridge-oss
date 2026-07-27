import type { ComponentType, ReactNode, CSSProperties } from 'react';

export type EnterpriseRoute = {
  path?: string;
  index?: boolean;
  element?: unknown;
  children?: EnterpriseRoute[];
};

/** @deprecated Legacy singular enterprise-plugin bridge only. */
export interface ComponentOverride {
  /** Stable extension point name (for example: `engines-page`). */
  name: string;
  /** UI component rendered by the host at the named extension point. */
  component: ComponentType<Record<string, unknown>>;
}

/** @deprecated Legacy singular enterprise-plugin bridge only. */
export interface FeatureOverride {
  /** Host feature flag identifier (for example: `multiTenant`). */
  flag: string;
  enabled: boolean;
}

export type EnterpriseNavItem = Record<string, unknown>;
export type EnterpriseMenuItem = Record<string, unknown>;

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
}

export interface EnterpriseFrontendPlugin {
  routes?: EnterpriseRoute[];
  tenantRoutes?: EnterpriseRoute[];
  navItems?: EnterpriseNavItem[];
  menuItems?: EnterpriseMenuItem[];
  /**
   * @deprecated Legacy singular enterprise-plugin bridge only. Native plugins
   * must use typed additive slots from `@enterpriseglue/plugin-sdk`.
   */
  componentOverrides?: ComponentOverride[];
  /**
   * @deprecated Legacy singular enterprise-plugin bridge only. Native plugins
   * cannot replace host feature flags.
   */
  featureOverrides?: FeatureOverride[];
  /** Called by the host after loading to provide shared utilities. */
  init?(context: FrontendPluginContext): void;
  /** @deprecated Unsupported by OSS host; keep EE UI slot extensions in `componentOverrides`. */
  headerSlots?: never;
  /** @deprecated Unsupported by OSS host; use `navItems` instead. */
  sidebarItems?: never;
}
