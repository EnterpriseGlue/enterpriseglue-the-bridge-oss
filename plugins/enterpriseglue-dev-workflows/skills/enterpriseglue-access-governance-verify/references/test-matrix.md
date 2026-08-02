# Access-governance test matrix

| Lane | Command | Select when |
|---|---|---|
| Structure | `pnpm run test:authz:structure` | Always for auth, identity, authorization, tenancy, or engine-governance changes |
| Decisions | `pnpm run test:authz:pr` | Roles, assignments, scopes, resources, policies, or tenant boundaries change |
| Fine-grained | `pnpm run test:authz:fine-grained:local` | Custom roles, actions, variable controls, machine principals, or mutation logic changes |
| Identity | `pnpm run test:identity:verify` | Providers, mappings, sessions, reconciliation, or login changes |
| Protocol emulators | `pnpm run test:identity:protocol-rehearsal` | OIDC, Entra-compatible OIDC, SAML, or LDAP behavior changes |
| Browser/accessibility | `pnpm run test:authz:browser` and `pnpm run test:authz:accessibility:cross-browser` | Access-control or identity UI changes |
| Engine tenancy | `pnpm run test:engine-tenancy:release-evidence` | Tenant defaults, engine modes, provisioning, or runtime mapping changes |
| Operaton/backstop | `pnpm run test:authz:adapter-backstop` | Engine-native, mirrored-backstop, sidecar, or adapter behavior changes |
| Database portability | `pnpm run test:engine-tenancy:database-matrix` | Entities, migrations, repositories, or persistence adapters change |
| Local deployment evidence | `pnpm run test:deployment-evidence:local` | Release-level access-governance acceptance is requested |

Do not run Camunda 7 lanes unless the change or user explicitly requires them.
