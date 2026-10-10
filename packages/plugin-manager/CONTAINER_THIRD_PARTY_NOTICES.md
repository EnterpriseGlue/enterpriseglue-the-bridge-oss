# Container third-party notices

The Plugin Manager container contains the compiled Apache-2.0 EnterpriseGlue OSS manager and its
declared production dependencies. It also redistributes ORAS CLI 1.3.4 and Cosign 3.1.3, compiled
from their immutable Go module releases with the patched Go toolchain and `golang.org/x/crypto` security floor
pinned in the `Dockerfile`. Cosign also pins `google.golang.org/grpc` to 1.83.2 to address
CVE-2026-84445. Both tools are Apache-2.0 licensed. Release automation generates the
authoritative third-party notice inventory and SBOM for each published image.

The pinned Go 1.26.9 standard library fixes CVE-2026-78667 and
CVE-2026-97031. Its BSD-3-Clause license text is installed at
`/usr/share/licenses/enterpriseglue-plugin-manager/Go-BSD-3-Clause.txt`.

The embedded tools also pin `golang.org/x/net` to 0.60.0, with its required
`golang.org/x/crypto` 0.57.0, `golang.org/x/text` 0.42.0 and
`golang.org/x/mod` 0.41.0 floors. This fixes
CVE-2026-78669 (GO-2026-6611) in the separately compiled HTTP/2 implementation;
the patched standard-library compiler alone does not fix older x/net modules.
These Go Authors modules use the retained BSD-3-Clause license.
