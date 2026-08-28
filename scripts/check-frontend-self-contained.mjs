import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const expectedFontPackages = {
  '@ibm/plex-mono': '1.1.0',
  '@ibm/plex-sans': '1.1.0',
  '@ibm/plex-sans-arabic': '1.1.0',
};
const expectedFontImports = [
  '@ibm/plex-mono/css/ibm-plex-mono-default.css',
  '@ibm/plex-sans/css/ibm-plex-sans-default.css',
  '@ibm/plex-sans-arabic/css/ibm-plex-sans-arabic-default.css',
];
const externalFontHostnames = new Set([
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  '1.www.s81c.com',
]);
const failures = [];

function containsExternalFontHost(source) {
  const normalized = source.toLowerCase();
  for (const marker of ['https://', 'http://']) {
    let cursor = 0;
    while (cursor < source.length) {
      const start = normalized.indexOf(marker, cursor);
      if (start < 0) break;
      let end = start + marker.length;
      while (
        end < source.length &&
        ![' ', '\t', '\r', '\n', '"', "'", ')', '(', ',', ';', '<', '>'].includes(source[end])
      ) {
        end += 1;
      }
      try {
        const candidate = new URL(source.slice(start, end));
        if (externalFontHostnames.has(candidate.hostname)) return true;
      } catch {
        // Continue scanning malformed source text for the next absolute URL.
      }
      cursor = Math.max(end, start + marker.length);
    }
  }
  return false;
}

const read = (relativePath) =>
  readFile(resolve(repositoryRoot, relativePath), 'utf8');

const [indexHtml, mainSource, viteConfig, nginxConfig, packageSource] =
  await Promise.all([
    read('frontend/index.html'),
    read('packages/frontend-host/src/main.tsx'),
    read('frontend/vite.config.ts'),
    read('frontend/nginx.conf'),
    read('packages/frontend-host/package.json'),
  ]);
const packageManifest = JSON.parse(packageSource);

for (const [packageName, version] of Object.entries(expectedFontPackages)) {
  if (packageManifest.dependencies?.[packageName] !== version) {
    failures.push(
      `packages/frontend-host/package.json: ${packageName} must be pinned to ${version}`,
    );
  }
}

for (const fontImport of expectedFontImports) {
  if (!mainSource.includes(`import '${fontImport}'`)) {
    failures.push(
      `packages/frontend-host/src/main.tsx: missing local font import ${fontImport}`,
    );
  }
}

for (const [relativePath, source] of [
  ['frontend/index.html', indexHtml],
  ['packages/frontend-host/src/main.tsx', mainSource],
]) {
  if (containsExternalFontHost(source)) {
    failures.push(`${relativePath}: external font host is not permitted`);
  }
}

if (
  !viteConfig.includes(
    "postcssPlugin: 'enterpriseglue-strip-external-carbon-font-faces'",
  ) ||
  !viteConfig.includes("atRule.name === 'font-face'") ||
  !viteConfig.includes("const externalCarbonFontHostname = '1.www.s81c.com'") ||
  !viteConfig.includes(
    'urlReferencesHostname(atRule.toString(), externalCarbonFontHostname)',
  )
) {
  failures.push(
    'frontend/vite.config.ts: Carbon external font-face removal is not configured',
  );
}

if (
  !nginxConfig.includes("font-src 'self' data:") ||
  containsExternalFontHost(nginxConfig)
) {
  failures.push(
    "frontend/nginx.conf: production font-src must remain limited to 'self' and data:",
  );
}

if (failures.length > 0) {
  process.stderr.write(
    `Self-contained frontend verification failed:\n${failures
      .map((failure) => `- ${failure}`)
      .join('\n')}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    'Self-contained frontend verification passed (local IBM Plex fonts, no external font hosts).\n',
  );
}
