#!/usr/bin/env python3
"""Build a versioned source-free Operaton Compose archive."""

import argparse
from pathlib import Path
import re
from zipfile import ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "infra/docker/selfhost-operaton"
HOST = ROOT / "infra/docker/compose/docker-compose.selfhost.yml"
FILES = (
    ".env.example",
    "compose.yaml",
    "compose.operaton.yaml",
    "compose.customer.yaml",
    "setup.mjs",
    "policy.disabled.json",
    "examples/direct.json",
    "examples/sidecar.json",
    "examples/sidecar-oidc.json",
    "examples/peer-auth-policy.json",
)


def build(tag, output):
    files = {"compose.host.yaml": HOST.read_bytes()}
    for name in FILES:
        content = (SOURCE / name).read_bytes()
        if name == ".env.example":
            content = content.replace(b"@RELEASE_TAG@", tag.encode("ascii"))
        files[name] = content

    output.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(output, "x") as archive:
        for name, content in sorted(files.items()):
            entry = ZipInfo(f"enterpriseglue-operaton-{tag}/{name}")
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, content)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tag", help="EnterpriseGlue release tag such as v0.35.10")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if not re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+", args.tag):
        parser.error("tag must be an exact version such as v0.35.10")
    build(args.tag, args.output)


if __name__ == "__main__":
    main()
