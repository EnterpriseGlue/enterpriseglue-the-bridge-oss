# Container third-party notices

The Plugin Manager container contains the compiled Apache-2.0 EnterpriseGlue OSS manager and its
declared production dependencies. It also redistributes ORAS CLI 1.3.3 and Cosign 3.1.3, compiled
from their immutable Go module releases with the patched Go toolchain and security dependency floors
pinned in the `Dockerfile`. Both tools are Apache-2.0 licensed. Release automation generates the
authoritative third-party notice inventory and SBOM for each published image.
