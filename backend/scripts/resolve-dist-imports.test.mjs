import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { resolveDistImports } from './resolve-dist-imports.mjs';

function fixture(t, paths = { '@app/*': ['src/*'] }) {
  const root = mkdtempSync(join(tmpdir(), 'eg-import-resolver-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (name, contents) => {
    const file = join(root, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, contents);
    return file;
  };
  put('package.json', '{"type":"module"}');
  put('src/main.ts', 'export {};');
  // Include JSON comments/trailing commas and inherited output options, as the real build does.
  put('tsconfig.json', '{"compilerOptions":{"rootDir":".","outDir":"dist",},}');
  const project = put('tsconfig.build.json', JSON.stringify({
    extends: './tsconfig.json',
    compilerOptions: { baseUrl: '.', paths },
    include: ['src/**/*.ts'],
  }));
  return { root, project, put, read: name => readFileSync(join(root, name), 'utf8') };
}

test('compiler aliases preserve executable ESM imports, exports, dynamic imports and package imports', t => {
  const f = fixture(t, {
    '@app/*': ['src/*'],
    '@app/entities/*': ['src/persistence/*'],
    '@exact': ['src/exact.ts'],
    '@fallback/*': ['src/missing/*', 'src/*'],
  });
  f.put('dist/src/value.js', 'export const value = 3;');
  f.put('dist/src/persistence/User.js', 'export const user = 4;');
  f.put('dist/src/exact.js', 'export const exact = 5;');
  f.put('dist/src/folder/index.js', 'export const folder = 6;');
  f.put('dist/src/main.js', `
import { value } from '@app/value.js';
import { user } from '@app/entities/User.js';
import { exact } from '@exact';
import { folder } from '@app/folder';
import { basename } from 'node:path';
export { value } from '@fallback/value.js';
const dynamic = await import('@app/value.js');
console.log(value + user + exact + folder + dynamic.value, basename('/a/b'));
`);
  assert.equal(resolveDistImports({ project: f.project }).replacements, 6);
  assert.match(f.read('dist/src/main.js'), /from '\.\/persistence\/User\.js'/);
  assert.match(f.read('dist/src/main.js'), /from 'node:path'/);
  const result = spawnSync(process.execPath, [join(f.root, 'dist/src/main.js')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '21 b');
  assert.equal(resolveDistImports({ project: f.project }).replacements, 0);
});

test('CommonJS requires, module resolution and test module mocks resolve emitted targets', t => {
  const f = fixture(t);
  f.put('dist/src/value.cjs', 'module.exports = 7;');
  f.put('dist/src/main.cjs', `console.log(require('@app/value.cjs'), require.resolve('@app/value.cjs'));`);
  f.put('dist/src/main.mjs', `import.meta.resolve('@app/value.cjs'); vi.mock('@app/value.cjs', () => ({}));`);
  assert.equal(resolveDistImports({ project: f.project }).replacements, 4);
  const result = spawnSync(process.execPath, [join(f.root, 'dist/src/main.cjs')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^7 .*value\.cjs/);
  assert.match(f.read('dist/src/main.mjs'), /vi\.mock\('\.\/value\.cjs'/);
});

test('wildcard substitution treats dollar replacement tokens as literal filename characters', t => {
  const f = fixture(t);
  f.put('dist/src/value$&.js', 'export const value = 9;');
  f.put('dist/src/main.js', `import { value } from '@app/value$&.js'; console.log(value);`);
  assert.equal(resolveDistImports({ project: f.project }).replacements, 1);
  assert.equal(f.read('dist/src/main.js'), `import { value } from './value$&.js'; console.log(value);`);
  const result = spawnSync(process.execPath, [join(f.root, 'dist/src/main.js')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '9');
});

test('ordinary strings, comments and templates retain their original contents', t => {
  const f = fixture(t);
  const content = `// import '@app/missing.js';\nconst label = '@app/missing.js';\nconst text = \`@app/missing.js\`;\n`;
  f.put('dist/src/main.js', content);
  assert.equal(resolveDistImports({ project: f.project }).replacements, 0);
  assert.equal(f.read('dist/src/main.js'), content);
});

test('missing emitted aliases fail before any file is rewritten', t => {
  const f = fixture(t);
  f.put('dist/src/value.js', 'export {};');
  const valid = `import '@app/value.js';`;
  f.put('dist/src/a.js', valid);
  f.put('dist/src/z.js', `import '@app/missing.js';`);
  assert.throws(() => resolveDistImports({ project: f.project }), /No emitted module for alias @app\/missing\.js/);
  assert.equal(f.read('dist/src/a.js'), valid);
});

test('declaration-only aliases and paths outside the compiler root fail closed', t => {
  const f = fixture(t, { '@types': ['src/types.d.ts'], '@outside': ['../outside.ts'] });
  f.put('dist/src/main.js', `import '@types';`);
  assert.throws(() => resolveDistImports({ project: f.project }), /No emitted module for alias @types/);
  f.put('dist/src/main.js', `import '@outside';`);
  assert.throws(() => resolveDistImports({ project: f.project }), /Alias escapes compiler root/);
});

test('the build entry point loads its project from the invoking backend directory', t => {
  const f = fixture(t);
  f.put('dist/src/value.js', 'export {};');
  f.put('dist/src/main.js', `import '@app/value.js';`);
  const script = fileURLToPath(new URL('./resolve-dist-imports.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script], { cwd: f.root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Resolved 1 path alias imports in 2 emitted files/);
  assert.equal(f.read('dist/src/main.js'), `import './value.js';`);
});
