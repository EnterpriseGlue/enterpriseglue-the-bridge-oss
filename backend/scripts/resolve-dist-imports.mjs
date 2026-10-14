#!/usr/bin/env node
/** Resolve emitted module imports using the compiler's path aliases, without glob dependencies. */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

function emittedPath(sourcePath) {
  return sourcePath.replace(/\.mts$/, '.mjs').replace(/\.cts$/, '.cjs').replace(/\.tsx?$/, '.js');
}

function moduleSpecifier(node) {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return node.moduleSpecifier;
  if (ts.isCallExpression(node)) {
    const callee = node.expression.getText();
    if (['import', 'require', 'require.resolve', 'import.meta.resolve',
      'vi.mock', 'vi.doMock', 'vi.importActual', 'vi.importMock'].includes(callee)) return node.arguments[0];
  }
  return undefined;
}

export function resolveDistImports({ project = resolve('tsconfig.build.json') } = {}) {
  const config = ts.getParsedCommandLineOfConfigFile(project, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic(diagnostic) {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    },
  });
  if (config.errors.length) {
    throw new Error(config.errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
  }
  const { rootDir, outDir, baseUrl, paths = {} } = config.options;
  if (!rootDir || !outDir || !baseUrl) throw new Error('Backend alias resolution requires rootDir, outDir and baseUrl.');
  const aliases = Object.entries(paths).sort(([a], [b]) => b.indexOf('*') - a.indexOf('*'));

  function resolveAlias(specifier, file) {
    // Exact mappings take precedence over wildcards, then the longest prefix wins.
    const matching = Object.hasOwn(paths, specifier)
      ? [[specifier, paths[specifier]]]
      : aliases.filter(([pattern]) => {
        const star = pattern.indexOf('*');
        return star >= 0 && specifier.startsWith(pattern.slice(0, star)) && specifier.endsWith(pattern.slice(star + 1));
      }).slice(0, 1);
    if (!matching.length) return null;
    const [pattern, targets] = matching[0];
    const star = pattern.indexOf('*');
    const rest = star < 0 ? '' : specifier.slice(star, specifier.length - (pattern.length - star - 1));
    for (const target of targets) {
      const source = resolve(baseUrl, target.replaceAll('*', () => rest));
      if (/\.d\.[cm]?ts$/.test(source)) continue; // Declarations have no emitted runtime module.
      const subpath = relative(rootDir, emittedPath(source));
      if (subpath.startsWith('..') || isAbsolute(subpath)) throw new Error(`Alias escapes compiler root: ${specifier}`);
      const emitted = join(outDir, subpath);
      const candidates = extname(emitted) ? [emitted] : [`${emitted}.js`, join(emitted, 'index.js')];
      const destination = candidates.find(p => existsSync(p));
      if (!destination) continue;
      const result = relative(dirname(file), destination).replace(/\\/g, '/');
      return result.startsWith('.') ? result : `./${result}`;
    }
    throw new Error(`No emitted module for alias ${specifier} in ${relative(outDir, file)}`);
  }

  const pendingDirectories = [outDir];
  const updates = [];
  let replacements = 0;
  let files = 0;
  while (pendingDirectories.length) {
    const directory = pendingDirectories.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) { pendingDirectories.push(file); continue; }
      if (!entry.isFile() || !/\.[cm]?js$/.test(entry.name)) continue;
      files++;
      const content = readFileSync(file, 'utf8');
      const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      const edits = [];
      function visit(node) {
        const literal = moduleSpecifier(node);
        if (literal && ts.isStringLiteralLike(literal)) {
          const replacement = resolveAlias(literal.text, file);
          if (replacement !== null) edits.push({ start: literal.getStart(source) + 1, end: literal.end - 1, replacement });
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
      if (!edits.length) continue;
      let rewritten = content;
      for (const edit of edits.sort((a, b) => b.start - a.start)) {
        rewritten = rewritten.slice(0, edit.start) + edit.replacement + rewritten.slice(edit.end);
      }
      replacements += edits.length;
      updates.push({ file, content: rewritten });
    }
  }
  // Validate the complete tree before writing: missing aliases fail the build without partial rewrites.
  for (const update of updates) writeFileSync(update.file, update.content);
  return { files, replacements };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { files, replacements } = resolveDistImports();
  console.log(`Resolved ${replacements} path alias imports in ${files} emitted files.`);
}
