import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const originalPlugin = "postcssPlugin: 'enterpriseglue-strip-external-carbon-font-faces'";
const fontDisplayPlugin = "postcssPlugin: 'enterpriseglue-carbon-font-faces'";
const originalRuleSelector = "atRule.name === 'font-face'";
const earlyReturnSelector = "if (atRule.name !== 'font-face') return";
const removeRemoteFaces = /if \(urlReferencesHostname\(atRule\.toString\(\), externalCarbonFontHostname\)\) \{\s*atRule\.remove\(\)\s*return\s*\}/;

function replaceGuardAssertion(source, from, to) {
  const parts = source.split(JSON.stringify(from));
  if (parts.length !== 2) throw Error('Could not verify the frozen Carbon font guard assertion.');
  return parts.join(JSON.stringify(to));
}

export function prepareFrontendGuard(originalGuard, viteConfig) {
  if (viteConfig.includes(originalPlugin) || !viteConfig.includes(fontDisplayPlugin)) {
    return originalGuard;
  }
  if (!viteConfig.includes(earlyReturnSelector) || !removeRemoteFaces.test(viteConfig)) {
    throw Error('Could not verify the frozen Carbon font guard and its external-font removal.');
  }
  const namedGuard = replaceGuardAssertion(originalGuard, originalPlugin, fontDisplayPlugin);
  return replaceGuardAssertion(namedGuard, originalRuleSelector, earlyReturnSelector);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const [workspace, destination] = process.argv.slice(2);
  if (!workspace || !destination) throw Error('Expected a frozen workspace and a temporary guard path.');
  const guard = readFileSync(join(workspace, 'scripts/check-frontend-self-contained.mjs'), 'utf8');
  const viteConfig = readFileSync(join(workspace, 'frontend/vite.config.ts'), 'utf8');
  writeFileSync(destination, prepareFrontendGuard(guard, viteConfig), { flag: 'wx', mode: 0o600 });
}
