import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'test/authz/engine-tenancy-functional-coverage.json');
const knownRequirementFamilies = new Set([
  'TEN-MODEL',
  'TEN-RESOLVE',
  'TEN-DEDICATED',
  'TEN-SHARED',
  'TEN-AUTHZ',
  'TEN-API',
  'TEN-CONFIG',
  'TEN-UI',
  'TEN-MIGRATION',
  'TEN-RUNTIME',
  'TEN-AUDIT',
  'TEN-DOCS',
  'TEN-OPS',
]);

test('validates every engine tenancy functional coverage entry', () => {
  const entries = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.ok(Array.isArray(entries) && entries.length > 0, 'coverage manifest must contain entries');

  const ids = new Set();
  for (const entry of entries) {
    assert.match(entry.id, /^TEN-[A-Z]+-\d{3}$/, `invalid requirement id: ${entry.id}`);
    assert.ok(!ids.has(entry.id), `duplicate requirement id: ${entry.id}`);
    ids.add(entry.id);
    assert.ok(
      knownRequirementFamilies.has(entry.id.replace(/-\d{3}$/, '')),
      `unknown requirement family: ${entry.id}`,
    );

    for (const field of [
      'requirement',
      'source',
      'expected',
      'testFile',
      'testName',
      'documentation',
      'ciJob',
    ]) {
      assert.equal(typeof entry[field], 'string', `${entry.id}.${field} must be a string`);
      assert.ok(entry[field].trim(), `${entry.id}.${field} must not be empty`);
    }
    assert.ok(
      Array.isArray(entry.dimensions) && entry.dimensions.length > 0,
      `${entry.id}.dimensions must not be empty`,
    );

    const testPath = path.join(root, entry.testFile);
    assert.ok(fs.existsSync(testPath), `${entry.id} test file does not exist: ${entry.testFile}`);
    const testSource = fs.readFileSync(testPath, 'utf8');
    assert.ok(
      testSource.includes(entry.testName),
      `${entry.id} test name is missing from ${entry.testFile}: ${entry.testName}`,
    );

    const documentationPath = path.join(root, entry.documentation);
    assert.ok(
      fs.existsSync(documentationPath),
      `${entry.id} documentation does not exist: ${entry.documentation}`,
    );
    const documentation = fs.readFileSync(documentationPath, 'utf8');
    assert.ok(
      documentation.includes(entry.id),
      `${entry.id} is not traceable from ${entry.documentation}`,
    );
  }
});
