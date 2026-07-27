# EnterpriseGlue OSS Architecture Overview

## Purpose
This index provides the recommended reading order for the EnterpriseGlue OSS architecture document set in `docs/architecture`.

## Recommended Reading Order

| Order | Document | Purpose |
| --- | --- | --- |
| 1 | `01-oss-system-context.md` | Understand the product boundary, actors, and external systems |
| 2 | `02-oss-logical-architecture.md` | Understand the main logical components and responsibilities |
| 3 | `03-oss-capability-map.md` | Understand the product capability domains |
| 4 | `04-oss-capability-to-logical-component-mapping.md` | Connect capabilities to logical ownership |
| 5 | `09-oss-authorization-access-control-model.md` | Understand platform admin, project, engine, and tenant authorization boundaries |
| 6 | `05-oss-application-container-architecture.md` | Understand runtime/application deployment structure |
| 7 | `06-oss-integration-architecture.md` | Understand external integration boundaries |
| 8 | `07-oss-security-and-trust-boundaries.md` | Understand trust boundaries, protection layers, and sensitive flows |
| 9 | `08-oss-information-data-architecture.md` | Understand key information domains and persistence boundaries |
| 10 | `10-oss-license-compliance-and-third-party-management.md` | Understand first-party Apache-2.0 alignment, third-party notice generation, and compliance controls |
| 11 | `11-oss-custom-rbac-and-engine-registration-plan.md` | Plan the backward-compatible move to custom roles, fine-grained permissions, external engine registration, and SSO-driven engine assignments |
| 12 | `12-plugin-platform-and-authoring.md` | Understand the reusable plugin contracts, trust boundaries, lifecycle, distribution, and new-plugin checklist |

## Document Relationship Diagram
```mermaid
flowchart TD
  Overview[Architecture Overview]

  subgraph Core[Core Architecture Views]
    direction TB
    Context[System Context]
    Logical[Logical Architecture]
    Capability[Capability Map]
    Mapping[Capability to Component Mapping]
    Authz[Authorization and Access Control]
  end

  subgraph RuntimeGroup[Runtime and Supporting Views]
    direction TB
    Runtime[Application and Container Architecture]
    Integration[Integration Architecture]
    Security[Security and Trust Boundaries]
    Data[Information and Data Architecture]
    License[License Compliance and Third-Party Management]
    RbacPlan[Custom RBAC and Engine Registration Plan]
    PluginPlatform[Plugin Platform and Authoring]
  end

  Overview --> Core
  Overview --> RuntimeGroup

  Context --> Logical
  Logical --> Capability
  Capability --> Mapping
  Logical --> Authz
  Runtime --> Integration
  Runtime --> Security
  Runtime --> Data
  Runtime --> License
  Runtime --> PluginPlatform
  Authz --> Security
  Authz --> RbacPlan
  Authz --> PluginPlatform
  Integration --> RbacPlan
  Integration --> PluginPlatform
  Security --> License
```

## Suggested Review Paths

### Domain Architect Path
- `01-oss-system-context.md`
- `02-oss-logical-architecture.md`
- `03-oss-capability-map.md`
- `04-oss-capability-to-logical-component-mapping.md`
- `09-oss-authorization-access-control-model.md`

### Security / Governance Review Path
- `01-oss-system-context.md`
- `09-oss-authorization-access-control-model.md`
- `11-oss-custom-rbac-and-engine-registration-plan.md`
- `07-oss-security-and-trust-boundaries.md`
- `06-oss-integration-architecture.md`
- `10-oss-license-compliance-and-third-party-management.md`
- `12-plugin-platform-and-authoring.md`

### Platform / Runtime Review Path
- `05-oss-application-container-architecture.md`
- `06-oss-integration-architecture.md`
- `08-oss-information-data-architecture.md`
- `07-oss-security-and-trust-boundaries.md`
- `10-oss-license-compliance-and-third-party-management.md`

## Core Architectural Themes
- **Host-based composition**
  - Thin frontend and backend shells delegate into host packages.

- **Modular domain capabilities**
  - Starbase, Mission Control, Engines, Git/Versioning, and Platform Admin form the main functional domains.

- **Shared platform foundation**
  - Shared config, persistence, services, schemas, and middleware live in `packages/shared`.

- **Permission-aware operational platform**
  - Authorization is expressed through platform roles, project roles, engine roles, and explicit grants.

- **Extension-ready OSS core**
  - OSS exposes extension points for enterprise composition without embedding EE-specific behavior into OSS domain modules.
