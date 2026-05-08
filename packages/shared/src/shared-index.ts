/**
 * Shared Package Root Export
 *
 * This is the main entry point for the shared package.
 *
 * NEW ARCHITECTURE (Clean Architecture):
 * - domain/     : Pure business logic (import from here for types)
 * - application/: Service orchestration (incrementally migrating)
 * - infrastructure/: External adapters (incrementally migrating)
 * - interfaces/: API / HTTP layer (incrementally migrating)
 *
 * LEGACY (still works during migration):
 * - db/         : Database entities
 * - services/   : Business logic
 * - middleware/ : HTTP middleware
 *
 * During the migration period, both paths work. After migration completes,
 * legacy paths will be deprecated.
 */

import 'reflect-metadata';

// New Clean Architecture layers (actively being populated)
export * from './domain/index.js';

// Application layer (minimal during migration)
export type * from './application/index.js';

// Infrastructure layer (minimal during migration)
export type * from './infrastructure/index.js';

// Interfaces layer (minimal during migration)
export type * from './interfaces/index.js';
