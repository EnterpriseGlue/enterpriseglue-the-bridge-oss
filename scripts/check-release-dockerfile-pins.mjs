import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const releaseDockerfiles = [
  'backend/Dockerfile.prod',
  'frontend/Dockerfile.prod',
  'packages/plugin-installer/Dockerfile',
  'packages/plugin-reference/Dockerfile',
  'packages/plugin-reference/fixtures/secondary-lifecycle/Dockerfile',
  'packages/plugin-reference/fixtures/secondary-lifecycle/Dockerfile.migration',
];
const digestReference =
  /^[^\s@]+(?::[A-Za-z0-9_.-]+)?@sha256:[a-f0-9]{64}$/u;
const failures = [];

for (const relativePath of releaseDockerfiles) {
  const source = await readFile(resolve(repositoryRoot, relativePath), 'utf8');
  const syntaxDirective = source.match(/^#\s*syntax=(\S+)$/mu);
  if (syntaxDirective && !digestReference.test(syntaxDirective[1])) {
    failures.push(
      `${relativePath}: Dockerfile syntax image must use an exact sha256 digest`,
    );
  }
  const stageAliases = new Set();
  const fromLines = source
    .split(/\r?\n/u)
    .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
    .filter(({ line }) => /^FROM\s+/iu.test(line));

  if (fromLines.length === 0) {
    failures.push(`${relativePath}: no FROM instruction found`);
    continue;
  }

  for (const { line, lineNumber } of fromLines) {
    const match = line.match(
      /^FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+([A-Za-z0-9_.-]+))?$/iu,
    );
    if (!match) {
      failures.push(`${relativePath}:${lineNumber}: unsupported FROM instruction`);
      continue;
    }

    const image = match[1];
    const alias = match[2];
    if (!stageAliases.has(image) && !digestReference.test(image)) {
      failures.push(
        `${relativePath}:${lineNumber}: external base image must use an exact sha256 digest`,
      );
    }
    if (alias) stageAliases.add(alias);
  }
}

if (failures.length > 0) {
  process.stderr.write(
    `Release Dockerfile pin verification failed:\n${failures
      .map((failure) => `- ${failure}`)
      .join('\n')}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Release Dockerfile pin verification passed (${releaseDockerfiles.length} files).\n`,
  );
}
