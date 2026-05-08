/**
 * Thin shell entry point — delegates to @enterpriseglue/backend-host.
 */
import 'reflect-metadata';
import { startServer } from '@enterpriseglue/backend-host/server.js';

await startServer();
