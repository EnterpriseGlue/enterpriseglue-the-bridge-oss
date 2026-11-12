#!/usr/bin/env python3
"""Check the source-free Operaton Compose archive and both supported layouts."""

import argparse
import http.cookiejar
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
from tempfile import TemporaryDirectory
import unittest
from urllib.request import build_opener, HTTPCookieProcessor, Request
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
TAG = "v0.35.10"


def build(output, tag=TAG):
    subprocess.run(
        ["python3", ROOT / "scripts/build-selfhost-operaton-kit.py", tag, output],
        check=True,
    )


class OperatonKitTest(unittest.TestCase):
    def test_package_and_compose_contract(self):
        with TemporaryDirectory(prefix="eg-operaton-kit-test-") as temp:
            root = Path(temp)
            first = root / "first.zip"
            second = root / "second.zip"
            build(first)
            build(second)
            self.assertEqual(first.read_bytes(), second.read_bytes())

            with ZipFile(first) as archive:
                archive.extractall(root)
            kit = root / f"enterpriseglue-operaton-{TAG}"
            self.assertEqual(
                (kit / "compose.host.yaml").read_bytes(),
                (ROOT / "infra/docker/compose/docker-compose.selfhost.yml").read_bytes(),
            )
            self.assertFalse((kit / ".env").exists())
            template = (kit / ".env.example").read_text()
            self.assertIn(f"IMAGE_TAG={TAG}\n", template)
            for example in (kit / "examples").glob("*.json"):
                bundle = json.loads(example.read_text())
                self.assertEqual(set(bundle["bundle"]["imports"]), set(bundle["files"]))
                self.assertEqual(bundle["bundle"]["apiVersion"], "enterpriseglue.ai/v1beta1")
            (kit / ".env").write_text(
                "OPERATON_IMAGE=registry.example.test/customer/operaton:1\n"
                "OPERATON_SIDECAR_IMAGE=registry.example.test/customer/sidecar:1\n"
                f"IMAGE_TAG={TAG}\n"
                "ADMIN_EMAIL=compose-test@example.test\n"
                "ADMIN_PASSWORD=compose-test-password\n"
                "POSTGRES_PASSWORD=compose-test-db-password\n"
                "JWT_SECRET=compose-test-jwt-secret\n"
                "ENCRYPTION_KEY=compose-test-key\n"
                "EG_ENGINE_ALLOWED_HOSTS=operaton,sidecar\n"
            )
            for profile in ([], ["--profile", "sidecar"]):
                with self.subTest(profile=profile):
                    rendered = subprocess.check_output(
                        ["docker", "compose", *profile, "config", "--format", "json"],
                        cwd=kit, text=True,
                    )
                    services = json.loads(rendered)["services"]
                    self.assertEqual("sidecar" in services, bool(profile))
                    self.assertEqual(services["operaton"]["image"], "registry.example.test/customer/operaton:1")
                    self.assertTrue(services["backend"]["image"].endswith(f":{TAG}"))
                    for service in ("operaton", "db", "backend", "sidecar"):
                        self.assertFalse(services.get(service, {}).get("ports"))
                    self.assertEqual(services["frontend"]["ports"][0]["host_ip"], "127.0.0.1")
                    self.assertEqual(
                        services["frontend"]["depends_on"]["setup"]["condition"],
                        "service_completed_successfully",
                    )
                    self.assertTrue(services["frontend"]["healthcheck"]["test"])
                    secrets = next(
                        volume for volume in services["backend"]["volumes"]
                        if volume["target"] == "/run/secrets"
                    )
                    self.assertTrue(secrets["read_only"])


def smoke_test(tag):
    with TemporaryDirectory(prefix="eg-operaton-kit-smoke-") as temp:
        root = Path(temp)
        archive = root / "kit.zip"
        build(archive, tag)
        with ZipFile(archive) as kit_archive:
            kit_archive.extractall(root)
        kit = root / f"enterpriseglue-operaton-{tag}"
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        base_url = f"http://localhost:{port}"
        email = "operaton-kit-smoke@example.test"
        password = secrets.token_hex(24)
        settings = {
            "IMAGE_TAG": tag,
            "OPERATON_IMAGE": "operaton/operaton@sha256:0843bc2b4cedf1d01fdc965203f8c213c3d63a810d49c43fc141608a6f9bb813",
            "FRONTEND_URL": base_url,
            "FRONTEND_HOST_PORT": port,
            "ADMIN_EMAIL": email,
            "ADMIN_PASSWORD": password,
            "POSTGRES_PASSWORD": secrets.token_hex(24),
            "JWT_SECRET": secrets.token_hex(32),
            "ENCRYPTION_KEY": secrets.token_hex(32),
            "EG_ENGINE_ALLOWED_HOSTS": "operaton",
            "EG_ALLOW_INSECURE_ENGINE_HTTP": "true",
        }
        for name in ("EG_BACKEND_IMAGE_REF", "EG_FRONTEND_IMAGE_REF"):
            if os.environ.get(name):
                settings[name] = os.environ[name]
        (kit / ".env").write_text("".join(f"{key}={value}\n" for key, value in settings.items()))
        (kit / ".env").chmod(0o600)
        (kit / "secrets").mkdir()
        (kit / "secrets/engine-password").write_text("demo")
        bundle = json.loads((kit / "examples/direct.json").read_text())
        engine = bundle["files"]["./engines.json"]["engines"][0]
        engine["baseUrl"] = "http://operaton:8080/engine-rest"
        engine["auth"]["username"] = "demo"
        (kit / "enterpriseglue-config.json").write_text(json.dumps(bundle))
        (kit / "compose.customer.yaml").write_text("""services:
  operaton:
    platform: linux/amd64
    environment:
      OPERATON_BPM_AUTHORIZATION_ENABLED: "true"
      OPERATON_BPM_RUN_AUTH_ENABLED: "true"
      OPERATON_BPM_RUN_EXAMPLE_ENABLED: "false"
    volumes:
      - ./fixture.bpmn:/tmp/fixture.bpmn:ro
""")
        (kit / "fixture.bpmn").write_bytes(
            (ROOT / "test/e2e/operaton-container/fixtures/authorization-process.bpmn").read_bytes()
        )
        project = "eg-operaton-kit-" + secrets.token_hex(6)

        def compose(*args, **kwargs):
            return subprocess.run(["docker", "compose", "-p", project, *args], cwd=kit, **kwargs)

        def sign_in():
            client = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
            credentials = json.dumps({"email": email, "password": password}).encode()
            login = Request(
                base_url + "/api/auth/login", data=credentials, headers={"Content-Type": "application/json"}
            )
            with client.open(login, timeout=15) as response:
                assert response.status == 200, "Local administrator could not sign in"
            with client.open(base_url + "/api/auth/me", timeout=15) as response:
                user = json.load(response)
            with client.open(base_url + "/engines-api/engines", timeout=15) as response:
                engines = json.load(response)
            assert user["platformRole"] == "admin", "Local account lacks platform administrator access"
            assert len(engines) == 1 and engines[0]["type"] == "operaton", "Expected one visible Operaton engine"
            return client, user["id"], engines[0]["id"]

        try:
            compose("up", "-d", "--wait", "--wait-timeout", "180", check=True)
            client, user_id, engine_id = sign_in()
            compose(
                "exec", "-T", "operaton", "curl", "-fsS", "-u", "demo:demo", "-F",
                "deployment-name=compose-smoke", "-F", "data=@/tmp/fixture.bpmn",
                "http://127.0.0.1:8080/engine-rest/deployment/create",
                check=True, stdout=subprocess.DEVNULL,
            )
            with client.open(base_url + f"/mission-control-api/process-definitions?engineId={engine_id}", timeout=15) as response:
                definitions = json.load(response)
            assert any(definition["key"] == "egprocess" for definition in definitions), "BPMN fixture was not visible"
            compose("up", "-d", "--wait", "--wait-timeout", "120", check=True)
            assert sign_in()[1:] == (user_id, engine_id), "Second launch changed the user or engine"
            print("Operaton Compose launch, admin and engine access, and repeat startup passed.")
        except Exception:
            compose("ps", "-a")
            compose("logs", "--tail", "25", "setup")
            raise
        finally:
            compose("down", "--volumes", "--timeout", "5", check=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", help="Start a disposable published-image stack")
    parser.add_argument("--tag", default=TAG, help="Application release tag used in the live archive")
    options = parser.parse_args()
    if options.live:
        smoke_test(options.tag)
    else:
        unittest.main(argv=[__file__])
