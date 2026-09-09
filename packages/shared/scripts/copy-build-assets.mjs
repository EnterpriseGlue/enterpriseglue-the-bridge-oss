import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const fromPackageRoot = (path) => new URL(path, `file://${packageRoot}/`);

await mkdir(fromPackageRoot('dist/db/adapters/'), { recursive: true });
await mkdir(fromPackageRoot('dist/contracts/'), { recursive: true });

await cp(
  fromPackageRoot('src/schema-epoch-manifest.json'),
  fromPackageRoot('dist/schema-epoch-manifest.json'),
);

await cp(
  fromPackageRoot('src/db/adapters/sql/'),
  fromPackageRoot('dist/db/adapters/sql/'),
  { recursive: true },
);

for (const file of ['members.d.ts', 'members.js', 'roles.d.ts', 'roles.js']) {
  await cp(
    fromPackageRoot(`src/contracts/${file}`),
    fromPackageRoot(`dist/contracts/${file}`),
  );
}
