# Plugin installer container notices

The EnterpriseGlue plugin-installer container redistributes the following
standalone command-line tools:

| Component | Version | License | Source |
|---|---:|---|---|
| ORAS CLI | 1.3.4 | Apache-2.0 | https://github.com/oras-project/oras |
| Cosign | 3.1.3 | Apache-2.0 | https://github.com/sigstore/cosign |

ORAS and Cosign are reproducibly compiled from their immutable Go module
releases with the patched Go toolchain and `golang.org/x/crypto` security floor pinned
in this package's `Dockerfile`. Cosign also pins `google.golang.org/grpc` to
1.83.2 to address CVE-2026-84445. The complete Apache License 2.0 text is
installed in the image at
`/usr/share/licenses/enterpriseglue-plugin-installer/Apache-2.0.txt`.

The JavaScript runtime-dependency inventory is recorded separately in
`third_party_licenses.json` and the repository-level
`THIRD_PARTY_NOTICES.md`.

The pinned Go 1.26.9 standard library fixes CVE-2026-78667 and
CVE-2026-97031. Its BSD-3-Clause license text is installed at
`/usr/share/licenses/enterpriseglue-plugin-installer/Go-BSD-3-Clause.txt`.
