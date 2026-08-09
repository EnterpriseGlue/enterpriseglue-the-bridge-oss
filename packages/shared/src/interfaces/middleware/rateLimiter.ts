// Compatibility export for consumers of the historical interfaces path.
// Keep one implementation so proxy trust, limiter budgets, and new guards
// cannot drift from the canonical middleware module.
export * from '../../middleware/rateLimiter.js';
