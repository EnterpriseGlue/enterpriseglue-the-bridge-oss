import { Router } from 'express';
import providersRouter from './providers.js';
import repositoriesRouter from './repositories.js';
import deploymentsRouter from './deployments.js';
import locksRouter from './locks.js';
import gitConnectionRouter from './gitConnection.js';

const router = Router();

// Mount sub-routers
router.use(providersRouter);
router.use(repositoriesRouter);
router.use(deploymentsRouter);
router.use(locksRouter);
router.use(gitConnectionRouter);

export default router;
