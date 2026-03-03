/**
 * Post-build script that rewrites @modules/* imports to relative paths
 * in the compiled dist/ output. Only touches @modules/* — all other
 * aliases (e.g. @enterpriseglue/*) are left as-is for node_modules resolution.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '..', 'dist');
const modulesDir = path.join(distDir, 'modules');

function rewriteFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  const original = content;

  // Match require('@modules/...') and import ... from '@modules/...'
  content = content.replace(
    /(['"])@modules\/([^'"]+)\1/g,
    (_match, quote, modulePath) => {
      const fileDir = path.dirname(filePath);
      const target = path.join(modulesDir, modulePath);
      let relative = path.relative(fileDir, target);

      // Ensure starts with ./
      if (!relative.startsWith('.')) {
        relative = './' + relative;
      }

      return `${quote}${relative}${quote}`;
    }
  );

  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
  }
}

function walkDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(full);
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.d.ts')) {
      rewriteFile(full);
    }
  }
}

walkDir(distDir);
console.log('Rewrote @modules/* imports to relative paths in dist/');
