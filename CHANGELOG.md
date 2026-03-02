# Changelog

All notable changes to this project will be documented in this file.

This project follows [Semantic Versioning](https://semver.org/) and uses [Release Please](https://github.com/googleapis/release-please) to manage release notes.

## [0.4.20](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.19...v0.4.20) (2026-03-02)


### Bug Fixes

* gracefully handle enterprise plugin on non-postgres databases ([#66](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/66)) ([c7e947c](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/c7e947cc03ed5262f8eb5bb9c04184715866dd91))

## [0.4.19](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.18...v0.4.19) (2026-03-02)


### Bug Fixes

* **oracle:** declare oracledb dependency and clarify env config ([#64](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/64)) ([ab27c12](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/ab27c128f6670bee30ec2ab198c65d49d33e8777))

## [0.4.18](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.17...v0.4.18) (2026-03-02)


### Features

* **plugin-api:** add FrontendPluginContext for dependency injection of host shared utilities ([#61](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/61)) ([c47923b](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/c47923b2811f6ae76a98ddba56a008cd4e1bcba0))

## [0.4.17](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.16...v0.4.17) (2026-03-01)


### Features

* **plugin-api:** add FrontendPluginContext for dependency injection of host shared utilities ([#61](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/61)) ([c47923b](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/c47923b2811f6ae76a98ddba56a008cd4e1bcba0))

## [0.4.16](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.15...v0.4.16) (2026-03-01)


### Features

* **starbase:** import from engine on create ([#57](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/57)) ([93e8a29](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/93e8a2925918db9fa9f9291845251d45a8c8ec03))

## [0.4.15](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.14...v0.4.15) (2026-02-28)


### Features

* **frontend:** add token pass count toggle on process detail ([#55](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/55)) ([bdd653e](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/bdd653ed426622b9d8c18e1e04d317cafec67522))

## [0.4.14](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.13...v0.4.14) (2026-02-28)


### Bug Fixes

* **mission-control:** fix process overview search filtering by name and parent instance ([#52](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/52)) ([54bb011](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/54bb0118576da320fda357d322333d19c339c51a))

## [0.4.13](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.12...v0.4.13) (2026-02-28)


### Bug Fixes

* **backend:** local variables shown in global variables ([#50](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/50)) ([baebec2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/baebec2ded9e77ba686f4a18772b8defcf16d57f))

## [0.4.12](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.11...v0.4.12) (2026-02-28)


### Bug Fixes

* **ci:** resolve Docker publish deadlock and add CVE details to nightly reports ([#47](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/47)) ([9fe949e](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/9fe949ea76ecdc9a481f979f2040d5539ecee1e4))

## [0.4.11](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.10...v0.4.11) (2026-02-27)


### Bug Fixes

* **security:** strip npm from runtime image to eliminate base-image CVEs ([#44](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/44)) ([9b584d5](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/9b584d58e3be4e16d63583f12d89755c8d8c56e5))

## [0.4.10](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.9...v0.4.10) (2026-02-27)


### Bug Fixes

* **ci:** trigger release-please on push to main ([#42](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/42)) ([0e4b602](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/0e4b6024a928b63233a8d42089a5317d6afa5f9e))

## [0.4.9](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.8...v0.4.9) (2026-02-27)


### Bug Fixes

* **ci:** make nightly CI read-only by replacing mutable marker with API lookup ([#38](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/38)) ([cc45720](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/cc4572086eef1baa831033452c1362d69e29f217))
* expose auth middleware to enterprise plugin via app.locals ([#39](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/39)) ([eda5d13](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/eda5d138bd40a9b40a31a581db42fb249a665d6b))
* **security:** bump minimatch override to ^10.2.4 ([#40](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/40)) ([44fc3e6](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/44fc3e6cc10c18260349136523a0ccde1a4818e2))

## [0.4.8](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.7...v0.4.8) (2026-02-26)


### Bug Fixes

* **ci:** clear ENTRYPOINT in runtime contract verification for Chainguard node ([#36](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/36)) ([597217d](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/597217d5aba95d3aa285dc097499e85c5f999e07))

## [0.4.7](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.6...v0.4.7) (2026-02-26)


### Features

* **security:** add nightly vulnerability drift scan workflow ([#32](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/32)) ([5996d2c](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/5996d2c3709407667afc7363fdc9e3f1d6b03c78))
* **security:** add Trivy PR gate and release gate with zero-tolerance policy ([#31](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/31)) ([30a0c33](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/30a0c33b3788fc693d6d1e40c0dce53355c2bc35))


### Bug Fixes

* **security:** update minimatch and fast-xml-parser transitive deps ([#33](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/33)) ([34ff726](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/34ff72614d4dacea6210f501792221188fc8a64a))
* **security:** update rollup to 4.59.0 (CVE-2026-27606) ([#30](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/30)) ([7b34401](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/7b344014f59008b1834caa9cbbdeca9115359fc5))

## [0.4.6](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.5...v0.4.6) (2026-02-26)


### Bug Fixes

* **ci:** auto-correct PR title and release label drift ([#28](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/28)) ([2c01f28](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/2c01f28cc59be0478b2fc38214be9e64a04a7647))

## [0.4.5](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.4...v0.4.5) (2026-02-26)


### Bug Fixes

* **ci:** replace nightly marker git push with GitHub API variable ([#25](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/25)) ([3af7fdd](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/3af7fdd8bba7a5ab3909127488daf405b2886b83))

## [0.4.4](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.3...v0.4.4) (2026-02-23)


### Bug Fixes

* refresh mission control menu and gate image smoke checks ([#20](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/20)) ([33bfeaf](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/33bfeafb18b1fd6772c58edb99abfb511171651f))

## [0.4.3](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.2...v0.4.3) (2026-02-23)


### Bug Fixes

* allow HTTP engine URLs for localhost/private networks in production ([#18](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/18)) ([29fccd0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/29fccd0fa8a1b16bc2f027a2d11641ee18efcf61))

## [0.4.2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.1...v0.4.2) (2026-02-23)


### Features

* add POSTGRES_URL and ORACLE_CONNECTION_STRING connection string support ([#16](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/16)) ([5178886](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/51788865b812141f260cee2cb5eb06eab6b6d1bf))

## [0.4.1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.0...v0.4.1) (2026-02-23)


### Bug Fixes

* **ci:** pass RELEASE_PLEASE_TOKEN to auto-merge so release PR merge triggers push workflows ([6c5e5b4](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/6c5e5b4738521194266d8c05d358a35feeead18b))

## [0.4.0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.3.2...v0.4.0) (2026-02-23)


### Features

* **ci:** add ci-watch helper script for one-command workflow monitoring ([ce42c93](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/ce42c930c74532d7365caa7359b0dbaf1cda8644))

## [0.3.2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.3.1...v0.3.2) (2026-02-23)


### Bug Fixes

* **ci:** derive Docker Hub image namespace from DOCKERHUB_USERNAME secret ([ea6db58](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/ea6db589d960b88782b58941f1d98e756ce19bfc))

## [0.3.1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.3.0...v0.3.1) (2026-02-23)


### Bug Fixes

* **ci:** use job-level env var for Docker Hub conditional to avoid secrets in if: expressions ([c2c7286](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/c2c72861db5397ffba0784114d71d2b9744f145e))

## [0.3.0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.2.0...v0.3.0) (2026-02-23)


### Features

* **selfhost:** add standalone selfhost compose, fix image placeholders, add secret hints ([123b3b4](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/123b3b4c2803b7fa46f87a065123433875f46f8f))

## [0.2.0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.1.3...v0.2.0) (2026-02-23)


### Features

* **ci:** add Docker Hub image publishing alongside GHCR ([86ed873](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/86ed873a6fa7b318d1ccc73587059f6c22b002eb))

## [0.1.3](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.1.2...v0.1.3) (2026-02-23)


### Bug Fixes

* **docker:** clarify compose invocation contract ([#7](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/7)) ([55732dc](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/55732dc2b2dda3d9728bee2f69d899a1ac5fc9ad))

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
