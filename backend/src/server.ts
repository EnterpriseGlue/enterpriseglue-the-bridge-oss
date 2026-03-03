/**
 * Thin shell entry point — delegates to @enterpriseglue/backend-host.
 */
import { startServer } from '@enterpriseglue/backend-host/server.js';

await startServer();
