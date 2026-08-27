/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly [key: string]: string | boolean | undefined;
  readonly VITE_API_BASE_URL?: string;
  // URL of a JSON document fetched at startup to configure the app at runtime
  // (currently `apiBaseUrl`). Empty/unset disables runtime config entirely.
  readonly VITE_RUNTIME_CONFIG_URL?: string;
  // When 'true', a missing/invalid runtime config (or one without a usable
  // apiBaseUrl) is a fatal boot error instead of a fall back to build-time values.
  readonly VITE_RUNTIME_CONFIG_REQUIRED?: string;
  readonly MODE: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
