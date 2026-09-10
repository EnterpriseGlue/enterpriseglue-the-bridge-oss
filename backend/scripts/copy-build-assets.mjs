import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const backendRoot = fileURLToPath(new URL('../', import.meta.url));
const source = new URL('../../packages/shared/src/schema-epoch-manifest.json', import.meta.url);
const destinationDirectory = new URL('dist/packages/shared/src/', `file://${backendRoot}/`);

await mkdir(destinationDirectory, { recursive: true });
await cp(source, new URL('schema-epoch-manifest.json', destinationDirectory));
