
## Browser and server dependency ownership

The shared package keeps its existing exports. Its regular installation
dependencies contain Zod, the OpenAPI schema extension, and the plugin SDK.
Browser consumers can use browser-safe schema subpaths, the permission-action
catalog, filename helpers, and contracts without installing database drivers,
mail transports, or an HTTP server. `schemas/common.js` and `schemas/openapi.js`
are server modules; the root entry point initializes server metadata. Browser
consumers must use the browser-safe subpaths rather than those entries.

Server libraries are optional peers, with the same version ranges also declared
as development dependencies so the shared package can build independently.
`@enterpriseglue/backend-host` provides every server peer as a regular production
dependency. Direct consumers of shared server modules must explicitly install
the peers their module needs; optional peers are not an instruction to skip a
runtime requirement. Existing server imports keep their paths and signatures.
This installation contract changes in shared 0.23.0 and is recorded as breaking
for direct server consumers.

The frontend app declares its frontend host as a runtime dependency. Its direct
shared dependency remains a development dependency for type/test consumers;
frontend-host declares shared as a regular dependency for browser runtime code.
Use a production audit of the installed consumer graph and a bundle check for
browser acceptance. The workspace's server development dependencies are not
part of that production browser graph.
