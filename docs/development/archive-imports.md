---
title: Bounded archive imports
doc_class: technical
publication: github
audience: developer
confidentiality: public
lifecycle: reference
---

# Bounded archive imports

Configuration bundles and Starbase project imports use an in-memory ZIP reader
in `packages/shared/src/utils/bounded-zip.ts`. It never extracts files into a
filesystem. Stored and deflated, single-disk ZIPs with UTF-8 filenames are
supported, including the streaming data descriptors emitted by the project's
`archiver` export path. Explicit directory entries may be empty.

ZIP64, multipart archives, encrypted entries, other compression methods,
non-UTF-8 filenames and special files (including symbolic links) are rejected.
Re-export such archives as ordinary stored/deflated ZIPs before import.

| Import | Compressed limit | Total declared/actual output limit | Entry limit |
| --- | --- | --- | --- |
| Configuration | 1 MiB by default | 1 MiB by default | 64 files; 128 records including directories |
| Project | 25 MiB | 100 MiB | 10,000 records including directories |

The configuration service's existing explicit `maxBytes` argument overrides
both byte limits together. JSON allowlists, normalized path uniqueness,
duplicate JSON-key rejection and the normal preview/apply authorization flow
remain in force. Project import still accepts BPMN/DMN and its root or legacy
manifest and ignores unrelated file types. The new project expansion and
record-count ceilings bound highly compressed input before allocating output.

Every central-directory length is checked against the input buffer before
entry lookup. Local headers and descriptors must agree with central metadata;
overlapping records and duplicate raw filenames are rejected. Node's native
zlib applies an independent output limit during inflation; actual byte count
and CRC32 are verified before parsed contents are used. A compressed entry
cannot use a dishonest small declared size to obtain unbounded output.

Focused regressions live in `backend/__tests__/shared/utils/bounded-zip.test.ts`
and the configuration/project archive service tests. The PostgreSQL-backed
`backend/test/integration/starbase-download.test.ts` exercises actual route
export/import, preserving folders, BPMN/DMN and Starbase links. `fflate` is a
test-only independent ZIP fixture encoder/decoder, not the production reader.
