/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly [key: string]: string | boolean | undefined;
  readonly VITE_API_BASE_URL?: string;
  readonly MODE: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
