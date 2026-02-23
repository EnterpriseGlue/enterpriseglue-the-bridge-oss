/**
 * Migration Entity Safety Guard
 *
 * Prevents migrations from dropping tables that still have active TypeORM
 * entity definitions. This catches the class of bug where migration 0004
 * dropped git_credentials while GitCredential was still in use.
 *
 * How it works:
 *  1. Collects all @Entity({ name: '...' }) table names from entity files.
 *  2. Scans all migration up() methods for dropTable / DROP TABLE calls.
 *  3. Fails if any migration attempts to drop a table that has an active entity.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ENTITIES_DIR = path.resolve(__dirname, '../../../src/shared/db/entities');
const MIGRATIONS_DIR = path.resolve(__dirname, '../../../src/shared/db/migrations');

function getEntityTableNames(): Set<string> {
  const tableNames = new Set<string>();
  const files = fs.readdirSync(ENTITIES_DIR).filter(f => f.endsWith('.ts') && f !== 'BaseEntity.ts' && f !== 'index.ts');

  for (const file of files) {
    const content = fs.readFileSync(path.join(ENTITIES_DIR, file), 'utf-8');
    // Match @Entity({ name: 'table_name' }) or @Entity({ name: "table_name" })
    const match = content.match(/@Entity\(\{\s*name:\s*['"]([^'"]+)['"]/);
    if (match) {
      tableNames.add(match[1]);
    }
  }

  return tableNames;
}

interface DropViolation {
  migration: string;
  table: string;
  line: number;
}

function findDropTableViolations(activeTableNames: Set<string>): DropViolation[] {
  const violations: DropViolation[] = [];
  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.ts'));

  for (const file of files) {
    const content = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    const lines = content.split('\n');

    // Only scan the up() method body (skip down())
    let inUp = false;
    let braceDepth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Detect start of up() method
      if (/public\s+async\s+up\s*\(/.test(line)) {
        inUp = true;
        braceDepth = 0;
      }

      if (inUp) {
        braceDepth += (line.match(/{/g) || []).length;
        braceDepth -= (line.match(/}/g) || []).length;

        // Check for dropTable calls
        // Patterns: queryRunner.dropTable('table'), queryRunner.dropTable(TABLE_CONST)
        const dropTableMatch = line.match(/dropTable\(\s*['"]([^'"]+)['"]/);
        if (dropTableMatch) {
          const tableName = dropTableMatch[1];
          if (activeTableNames.has(tableName)) {
            violations.push({ migration: file, table: tableName, line: i + 1 });
          }
        }

        // Check for dropTable with variable reference (e.g. dropTable(GIT_CREDS_TABLE))
        const dropTableVarMatch = line.match(/dropTable\(\s*([A-Z_]+)/);
        if (dropTableVarMatch) {
          const varName = dropTableVarMatch[1];
          // Resolve the variable from the file
          const varMatch = content.match(new RegExp(`const\\s+${varName}\\s*=\\s*['"]([^'"]+)['"]`));
          if (varMatch && activeTableNames.has(varMatch[1])) {
            violations.push({ migration: file, table: varMatch[1], line: i + 1 });
          }
        }

        // Check for raw DROP TABLE SQL
        const rawDropMatch = line.match(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?["']?(\w+)["']?/i);
        if (rawDropMatch) {
          const tableName = rawDropMatch[1];
          if (activeTableNames.has(tableName)) {
            violations.push({ migration: file, table: tableName, line: i + 1 });
          }
        }

        // End of up() method
        if (braceDepth <= 0 && i > 0) {
          inUp = false;
        }
      }
    }
  }

  return violations;
}

describe('Migration entity safety guard', () => {
  it('collects entity table names from entity files', () => {
    const tableNames = getEntityTableNames();
    // Sanity check: we should have a good number of entities
    expect(tableNames.size).toBeGreaterThan(10);
    // Spot-check known tables
    expect(tableNames.has('users')).toBe(true);
    expect(tableNames.has('git_credentials')).toBe(true);
    expect(tableNames.has('git_providers')).toBe(true);
  });

  it('no migration drops a table that still has an active entity', () => {
    const activeTableNames = getEntityTableNames();
    const violations = findDropTableViolations(activeTableNames);

    const details = violations
      .map(v => `  - ${v.migration}:${v.line} drops "${v.table}"`)
      .join('\n');

    expect(violations, 
      `Migration(s) drop table(s) that still have active entity definitions:\n${details}\n\n` +
      'If the entity is no longer needed, remove the entity file first.\n' +
      'If the table is still in use, make the migration a no-op.'
    ).toHaveLength(0);
  });
});
