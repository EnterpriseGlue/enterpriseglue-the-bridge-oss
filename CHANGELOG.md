# Changelog

All notable changes to this project will be documented in this file.

This project follows [Semantic Versioning](https://semver.org/) and uses [Release Please](https://github.com/googleapis/release-please) to manage release notes.

## [0.1.0] - 2026-02-22

### Added
- Initial release governance scaffolding:
  - Release Please workflow and manifest/config
  - Release policy workflow for release labels and breaking-change notes
  - Docker image publishing workflow with smoke checks
  - Image deployment compose overlays and env templates

### Changed
- Added containerized smoke coverage for image deployments (Postgres and Oracle), including Nginx-proxied auth and Playwright smoke tests.
