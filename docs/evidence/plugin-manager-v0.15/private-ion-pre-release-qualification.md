# Private ION Support pre-release qualification

Date: 2026-08-24

OSS source under test: local `feat/native-plugin-manager` worktree targeting OSS `v0.15.0`

Private source under test: local `EnterpriseGlue/ion-support-agent` working tree

Boundary: the private working tree was not copied, edited, staged, or committed by this
qualification. Only generated `node_modules` links were redirected for the command duration and
restored automatically. The OSS paid-plugin source boundary passed separately with zero private
dependencies, source references, or product markers.

## Results

| Check | Result | Evidence |
| --- | --- | --- |
| Private frontend/backend plugin bundle builds against OSS SDK `0.3.0` package and plugin ABI `0.2.0` | Passed | `build:plugin-bundle:synthetic` |
| Publisher-key overlap and rotation | Passed | old and replacement keys accepted during overlap; retired key rejected |
| Security-revoked artifact | Passed | release selection rejected |
| Entitlement active, grace, wind-down, expired, and revoked behavior | Passed | closed state assertions all passed |
| Current/previous plugin ABI coexistence | Passed | ION SDK `0.2.0` and reference SDK `0.1.0` activated together |
| Independent disable and deterministic navigation | Passed | reference plugin disabled while ION remained enabled |
| v0.15 host compatibility | Passed after structural fix | ION and reference bundles both derive their host range from the OSS release identity |

The first multi-plugin run correctly failed because the public reference plugin had a hard-coded
`>=0.14.0 <0.15.0` host range. The OSS builder now derives `>=current-host <next-host-minor` from
`pluginPlatformReleaseIdentityV1`, preventing that stale-range failure in future OSS releases.

## Remaining protected-release evidence

This local qualification is not a private commercial release receipt. After OSS `v0.15.0` is
published, the protected private workflow must still:

- consume the exact released OSS commit and published package/image digests;
- publish a clean signed `PluginReleaseV1` and complete immutable OCI closure;
- exercise connected and complete physical-air-gap install/update using real registry content;
- exercise rollback/export/uninstall through the documented CLI fallback;
- record Compose, Kubernetes, OpenShift, current/previous host, and architecture/database evidence;
- scan, attest, and sign the private images and package; and
- keep every private artifact, entitlement document, and commercial secret outside OSS.
