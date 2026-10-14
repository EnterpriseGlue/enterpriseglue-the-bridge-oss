---
doc_class: technical
audience: developer, architect, operator, maintainer
publication: github
lifecycle: as-built
---

# Backend compilation and module resolution

Use the repository's supported Node 24 runtime and pinned pnpm version, then
install the workspace with `pnpm install --frozen-lockfile`. Both backend build
commands use the same compilation pipeline:

```bash
pnpm --dir backend run build
pnpm --dir backend run build:skip-generate
```

The build first compiles the required public workspace packages. TypeScript
then emits the application, backend host and shared sources under
`backend/dist`, following `backend/tsconfig.build.json`. The maintained
`backend/scripts/resolve-dist-imports.mjs` reads that same compiler configuration
and converts its runtime path aliases into relative emitted module paths.
Specific adapter/entity aliases take precedence over the general shared alias.
Normal package imports, including the plugin SDK and runtime, remain package
imports. Build assets are copied after module resolution.

The resolver uses the existing TypeScript compiler and Node filesystem APIs.
It needs no globbing or watching package. Static imports, re-exports, literal
dynamic imports, CommonJS requires, module-resolution calls and Vitest module
mocks are resolved; ordinary strings and comments remain unchanged. A mapped
runtime import without a corresponding emitted module fails the build before
any rewritten files are saved. Type-only declarations have no emitted runtime
module and must not be imported at runtime.

`backend/Dockerfile.prod` uses the same resolver for both the standard and
optional Oracle image targets. The final image continues to assemble only
production dependencies. The managed-shard bootstrap still uses its pinned
predecessor's compiled migrations and schema plan with production dependencies;
this build-tool repair does not change those identities.

The separate `tsc-alias` step was removed to eliminate its transitive
`braces` 3.0.3 dependency, affected by CVE-2026-93687. This removes the vulnerable
build dependency without an advisory suppression. GitHub's default-branch
alert is resolved after the corrected lockfile reaches the default branch;
an unchanged published image is not rebuilt by a local dependency edit.

Run the focused resolver checks with:

```bash
pnpm --dir backend exec node --test scripts/resolve-dist-imports.test.mjs
```

They also run through the backend unit-test command. For build-tool changes,
verify a complete backend build and compiled module imports in addition to
these fixtures. Container, database and security acceptance remain required
where selected by the protected CI and release pipelines.
