/**
 * Platform Admin API Routes
 * Aggregator that mounts domain-specific routers
 * Requires authentication; per-route permissions enforce access
 */

import { Router } from 'express';
import { requireAuth } from '@shared/middleware/auth.js';

import settingsRouter from './settings.js';
import brandingRouter from './branding.js';
import environmentsRouter from './environments.js';
import governanceRouter from './governance.js';

const router = Router();

// All routes require authentication; permissions are enforced per route
router.use(requireAuth);

// Mount domain-specific routers
router.use('/settings', settingsRouter);
router.use('/branding', brandingRouter);
router.use('/environments', environmentsRouter);

// Governance routes are mounted at root level for their specific paths
router.use('/', governanceRouter);

export default router;
