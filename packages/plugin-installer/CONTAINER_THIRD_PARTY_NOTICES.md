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

The pinned Go 1.26.10 standard library also fixes CVE-2026-111943 and retains the fixes for CVE-2026-78667 and
CVE-2026-97031. Its BSD-3-Clause license text is installed at
`/usr/share/licenses/enterpriseglue-plugin-installer/Go-BSD-3-Clause.txt`.

The embedded tools also pin `golang.org/x/net` to 0.60.0, with its required
`golang.org/x/crypto` 0.57.0, `golang.org/x/text` 0.42.0 and
`golang.org/x/mod` 0.41.0 floors. This fixes
CVE-2026-78669 (GO-2026-6611) in the separately compiled HTTP/2 implementation;
the patched standard-library compiler alone does not fix older x/net modules.
These Go Authors modules use the retained BSD-3-Clause license.

Cosign also pins `github.com/klauspost/compress` to 1.18.7 to address
CVE-2026-63209 (GHSA-259r-337f-4rfw). The module uses the BSD-3-Clause license.

The Cosign rebuild pins `github.com/go-jose/go-jose/v4` to 4.1.6 to address
CVE-2026-116587 (GHSA-mgcc-cww5-fp2q). The Apache-2.0 module retains its upstream
4096-bit RSA modulus limit for JWK parsing; the build does not raise this bound.
