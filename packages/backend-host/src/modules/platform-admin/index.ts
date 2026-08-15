/**
 * Platform Admin Module
 * Platform administration, tenants, users, SSO, authorization
 */
export { platformAdminRoute } from './routes/index.js';
export { default as authzRoute } from './routes/authz.js';
export { default as identityProvidersRoute } from './routes/identity-providers.js';
export { default as identityMappingsRoute } from './routes/identity-mappings.js';
export { default as identityProvisioningRoute } from './routes/identity-provisioning.js';
