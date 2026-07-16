import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface SamlSigningMaterial {
  privateKey: string;
  certificate: string;
}

/**
 * Produces short-lived, test-only signing material. Neither the key nor the
 * certificate is written to the repository or exposed outside the test
 * process. OpenSSL is already required by the supported test/CI images for
 * TLS validation; use it here solely to issue a self-signed X.509 certificate
 * for node-saml's production validation boundary.
 */
export function createSamlSigningMaterial(): SamlSigningMaterial {
  const directory = mkdtempSync(join(tmpdir(), 'enterpriseglue-saml-mock-'));
  const privateKeyPath = join(directory, 'key.pem');
  const certificatePath = join(directory, 'certificate.pem');

  try {
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
    execFileSync('openssl', [
      'req', '-x509', '-new', '-key', privateKeyPath,
      '-sha256', '-days', '1', '-subj', '/CN=enterpriseglue-saml-test-mock',
      '-out', certificatePath,
    ], { stdio: 'pipe' });

    return { privateKey, certificate: readFileSync(certificatePath, 'utf8') };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
