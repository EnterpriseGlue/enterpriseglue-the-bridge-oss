import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  enterpriseGlueManualChunk,
  packageNameFromModuleId,
} from '../../build/manual-chunks.mjs'
import {
  enforcePublicLoginSignupBudget,
  measurePublicLoginSignupBundle,
} from '../../build/bundle-budget.mjs'

const repositoryRoot = resolve(process.cwd(), '..')
const readRepositoryFile = (path: string) => readFile(resolve(repositoryRoot, path), 'utf8')

describe('frontend delivery performance', () => {
  it('resolves real packages from pnpm module IDs and preserves intentional chunk groups', () => {
    const pnpmRoot = '/workspace/node_modules/.pnpm'
    const examples: Array<[string, string, string]> = [
      [`${pnpmRoot}/@carbon+react@1.102.0_react@19.2.4/node_modules/@carbon/react/es/index.js`, '@carbon/react', 'carbon-vendor'],
      [`${pnpmRoot}/react-dom@19.2.4_react@19.2.4/node_modules/react-dom/client.js`, 'react-dom', 'react-vendor'],
      [`${pnpmRoot}/bpmn-js@18.9.1/node_modules/bpmn-js/lib/Modeler.js`, 'bpmn-js', 'bpmn-vendor'],
      [`${pnpmRoot}/dmn-js@17.4.0/node_modules/dmn-js/lib/Manager.js`, 'dmn-js', 'bpmn-vendor'],
      [`${pnpmRoot}/zod@4.4.3/node_modules/zod/index.js`, 'zod', 'vendor-zod'],
    ]
    for (const [moduleId, packageName, chunk] of examples) {
      expect(packageNameFromModuleId(moduleId)).toBe(packageName)
      expect(enterpriseGlueManualChunk(moduleId)).toBe(chunk)
    }

    expect(packageNameFromModuleId(
      'C:\\repo\\node_modules\\.pnpm\\@tanstack+react-query@5.102.0\\node_modules\\@tanstack\\react-query\\index.js',
    )).toBe('@tanstack/react-query')
    expect(enterpriseGlueManualChunk('/workspace/src/Login.tsx')).toBeUndefined()
    expect(enterpriseGlueManualChunk('/workspace/node_modules/react/index.css?used')).toBeUndefined()
  })

  it('measures only the static public entry graph and rejects budget regressions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'enterpriseglue-bundle-budget-'))
    try {
      await mkdir(join(directory, 'assets'))
      await Promise.all([
        writeFile(join(directory, 'assets/entry.js'), 'e'.repeat(100)),
        writeFile(join(directory, 'assets/react.js'), 'r'.repeat(200)),
        writeFile(join(directory, 'assets/lazy.js'), 'l'.repeat(5000)),
        writeFile(join(directory, 'assets/entry.css'), 'c'.repeat(80)),
      ])
      const measurement = await measurePublicLoginSignupBundle(directory, {
        'index.html': {
          file: 'assets/entry.js',
          isEntry: true,
          imports: ['_react.js'],
          dynamicImports: ['lazy.tsx'],
          css: ['assets/entry.css'],
        },
        '_react.js': { file: 'assets/react.js' },
        'lazy.tsx': { file: 'assets/lazy.js', isDynamicEntry: true },
      })

      expect(measurement).toMatchObject({
        initialJavaScriptRequests: 2,
        initialJavaScriptRawBytes: 300,
        initialCssRawBytes: 80,
        largestInitialJavaScriptFile: 'assets/react.js',
      })
      expect(() => enforcePublicLoginSignupBudget(measurement)).not.toThrow()
      expect(() => enforcePublicLoginSignupBudget(measurement, {
        maxInitialTransferGzipBytes: 1,
        maxLargestInitialJavaScriptRawBytes: 1,
        maxLargestInitialJavaScriptGzipBytes: 1,
        maxInitialJavaScriptRequests: 1,
      })).toThrow(/Public login\/signup bundle budget failed/)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('compresses only immutable JavaScript and CSS at the Nginx asset boundary', async () => {
    const nginx = await readRepositoryFile('frontend/nginx.conf')
    const assetsBlock = nginx.match(/location \/assets\/ \{([\s\S]*?)^  \}/m)?.[1] ?? ''
    expect(assetsBlock).toMatch(/^    gzip on;$/m)
    expect(assetsBlock).toMatch(/^    gzip_comp_level 6;$/m)
    expect(assetsBlock).toMatch(/^    gzip_min_length 1024;$/m)
    expect(assetsBlock).toMatch(/^    gzip_proxied any;$/m)
    expect(assetsBlock).toMatch(/^    gzip_vary on;$/m)
    expect(assetsBlock).toMatch(/^    gzip_types text\/css application\/javascript;$/m)
    expect(assetsBlock).toMatch(/Cache-Control "public, max-age=31536000, immutable"/)
  })

  it('enforces the generated production graph and removes its temporary manifest', async () => {
    const vite = await readRepositoryFile('frontend/vite.config.ts')
    const packageManifest = JSON.parse(await readRepositoryFile('frontend/package.json'))
    expect(vite).toMatch(/manualChunks: enterpriseGlueManualChunk/)
    expect(vite).toMatch(/manifest: 'bundle-budget-manifest\.json'/)
    expect(packageManifest.scripts.build).toMatch(
      /vite build && node build\/check-bundle-budget\.mjs dist/,
    )
    expect(await readRepositoryFile('frontend/build/check-bundle-budget.mjs')).toMatch(
      /removeManifest: true/,
    )
  })
})
