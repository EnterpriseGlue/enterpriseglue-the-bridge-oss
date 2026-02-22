# Changelog

All notable changes to this project will be documented in this file.

This project follows [Semantic Versioning](https://semver.org/) and uses [Release Please](https://github.com/googleapis/release-please) to manage release notes.

## [0.1.2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.1.1...v0.1.2) (2026-02-22)


### Bug Fixes

* **oracle:** dedupe Oracle bootstrap indexes ([#4](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/4)) ([140f5dd](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/140f5dd454fa468842f017bae8abde0700dec3cc))

## [0.1.1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.1.0...v0.1.1) (2026-02-22)


### Bug Fixes

* apply audit rate limiting middleware ([9ea42a4](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/9ea42a44ebbcfba97ea5363b0b596f8af0361fc0))
* build backend from repo root ([2f47305](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/2f473052f1367577106c8e5e94742c746f1bbc9f))
* pin lodash-es to 4.17.23 ([d7e3f1e](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/d7e3f1e5bbd0a2d20967638a72821130bb2c0513))
* proxy tenant-scoped API routes in dev ([05f61cf](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/05f61cf7c06a01a98693c02292e04632f58e00e9))
* resolve Open Redirect in useOnlineProjectWizard.ts and Dashboard.tsx ([0bb79bd](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/0bb79bd3750189c0242849c21396c22f86ef452d))
* resolve remaining CodeQL security alerts ([#190](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/190), [#192](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/192), [#187](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/187)) ([59ebbe0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/59ebbe037e11ca27b845ec5e288b7a18911ff885))
* resolve Snyk DOM XSS and Open Redirect vulnerabilities (CWE-79, CWE-601) ([1b4d7f9](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/1b4d7f93e997fdd2945fd429e1b511499fbe80d2))
* support legacy migration generate route ([5e89371](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/5e893719ff8f400567254be2a9ea866d4201d558))

## [0.1.0] - 2026-02-22

### Added
- Initial release governance scaffolding:
  - Release Please workflow and manifest/config
  - Release policy workflow for release labels and breaking-change notes
  - Docker image publishing workflow with smoke checks
  - Image deployment compose overlays and env templates

### Changed
- Added containerized smoke coverage for image deployments (Postgres and Oracle), including Nginx-proxied auth and Playwright smoke tests.
