#!/usr/bin/env npx tsx

/// <reference types="node" />

import { promises as fs } from 'node:fs';
import path from 'node:path';

type Pattern = {
  label: string;
  regex: RegExp;
};

type Violation = {
  filePath: string;
  lineNumber: number;
  pattern: string;
  line: string;
};

const maybeProcess = (globalThis as any).process as
  | { cwd?: () => string; exit?: (code?: number) => void }
  | undefined;

const ROOT = maybeProcess?.cwd ? maybeProcess.cwd() : '.';
// OSS canonical scope: enforce against runtime, scripts, and tests.
// Keep broad to prevent regressions from reintroducing raw SQL usage anywhere in backend code.
const TARGET_DIRS = ['src', 'scripts', 'test', '__tests__'];
const FILE_EXTENSIONS = new Set(['.ts', '.js']);
const IGNORED_DIRS = new Set(['node_modules', 'dist', '.git', 'migrations']);
const IGNORED_FILES = new Set(['check-no-raw-sql.ts']);

const RAW_QUERY_PATTERNS: Pattern[] = [
  { label: 'dataSource.query(', regex: /\bdataSource\.query\s*\(/ },
  { label: 'queryRunner.query(', regex: /\bqueryRunner\.query\s*\(/ },
  { label: 'manager.query(', regex: /\bmanager\.query\s*\(/ },
  { label: 'repository.query(', regex: /\brepository\.query\s*\(/ },
  { label: 'getConnectionPool().query(', regex: /\bgetConnectionPool\s*\(\s*\)\.query\s*\(/ },
  { label: '*.getCreateSchemaSQL(', regex: /\.\s*getCreateSchemaSQL\s*\(/ },
];

async function collectFiles(dirPath: string, out: string[]): Promise<void> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        await collectFiles(fullPath, out);
      }
      continue;
    }

    if (!entry.isFile()) continue;
    if (IGNORED_FILES.has(entry.name)) continue;

    const ext = path.extname(entry.name);
    if (FILE_EXTENSIONS.has(ext)) {
      out.push(fullPath);
    }
  }
}

async function scanFile(filePath: string): Promise<Violation[]> {
  const src = await fs.readFile(filePath, 'utf8');
  const lines = src.split(/\r?\n/);
  const violations: Violation[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    for (const pattern of RAW_QUERY_PATTERNS) {
      if (pattern.regex.test(line)) {
        violations.push({
          filePath,
          lineNumber: i + 1,
          pattern: pattern.label,
          line: line.trim(),
        });
      }
    }
  }

  return violations;
}

async function main(): Promise<void> {
  const files: string[] = [];

  for (const dir of TARGET_DIRS) {
    const absolute = path.join(ROOT, dir);
    try {
      const stat = await fs.stat(absolute);
      if (stat.isDirectory()) {
        await collectFiles(absolute, files);
      }
    } catch {
      // Skip missing directories.
    }
  }

  const violations: Violation[] = [];
  for (const filePath of files) {
    const fileViolations = await scanFile(filePath);
    violations.push(...fileViolations);
  }

  if (violations.length === 0) {
    console.log('✅ No forbidden raw SQL execution calls found.');
    return;
  }

  console.error('❌ Forbidden raw SQL execution calls detected:\n');
  for (const v of violations) {
    const relativePath = path.relative(ROOT, v.filePath);
    console.error(`- ${relativePath}:${v.lineNumber} [${v.pattern}]`);
    console.error(`  ${v.line}`);
  }

  if (maybeProcess?.exit) {
    maybeProcess.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ Raw SQL guard failed:', error);
  if (maybeProcess?.exit) {
    maybeProcess.exit(1);
  }
});
