process.env.NODE_ENV = 'test';

// The shared configuration module validates this value at import time. Tests
// use a deterministic, non-secret key so a clean checkout never depends on a
// developer .env file or a CI secret.
process.env.ENCRYPTION_KEY ??=
  '0000000000000000000000000000000000000000000000000000000000000000';
process.env.POSTGRES_URL ??= 'postgres://test:test@127.0.0.1:5432/enterpriseglue_test';
// Match the disposable PostgreSQL acceptance fixture, which creates this
// schema before running the plugin-platform migrations.
process.env.POSTGRES_SCHEMA ??= 'main';
