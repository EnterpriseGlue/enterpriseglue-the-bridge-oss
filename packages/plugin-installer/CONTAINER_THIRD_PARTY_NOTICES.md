# Plugin installer container notices

The EnterpriseGlue plugin-installer container redistributes the following
standalone command-line tools:

| Component | Version | License | Source |
|---|---:|---|---|
| ORAS CLI | 1.3.3 | Apache-2.0 | https://github.com/oras-project/oras |
| Cosign | 3.1.2 | Apache-2.0 | https://github.com/sigstore/cosign |

Both tools are copied unchanged from the immutable container-image digests
recorded in this package's `Dockerfile`. The complete Apache License 2.0 text
is installed in the image at
`/usr/share/licenses/enterpriseglue-plugin-installer/Apache-2.0.txt`.

The JavaScript runtime-dependency inventory is recorded separately in
`third_party_licenses.json` and the repository-level
`THIRD_PARTY_NOTICES.md`.
