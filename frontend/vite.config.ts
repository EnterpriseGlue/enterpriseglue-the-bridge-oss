import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { createRequire } from 'node:module'

export default defineConfig(({ mode }) => {
  const proxyTarget = (globalThis as any).process?.env?.DEV_PROXY_TARGET || 'http://localhost:8787'
  const manualChunks = (id: string) => {
    if (!id.includes('node_modules') || id.endsWith('.css')) {
      return undefined
    }

    const packagePath = id.split('node_modules/')[1]
    if (!packagePath) {
      return undefined
    }

    const packageName = packagePath.startsWith('@')
      ? packagePath.split('/').slice(0, 2).join('/')
      : packagePath.split('/')[0]
    const normalizedName = packageName.replace(/^@/, '').replace(/\//g, '-')

    if (
      packageName === '@bpmn-io/properties-panel' ||
      packageName.startsWith('@bpmn-io/') ||
      packageName.startsWith('bpmn-') ||
      packageName === 'bpmnlint' ||
      packageName.startsWith('bpmnlint-') ||
      packageName.startsWith('camunda-bpmn-') ||
      packageName === 'camunda-bpmn-js' ||
      packageName === 'camunda-bpmn-moddle' ||
      packageName === 'diagram-js' ||
      packageName.startsWith('diagram-js-') ||
      packageName.startsWith('moddle') ||
      packageName === 'ids' ||
      packageName === 'min-dash' ||
      packageName === 'min-dom' ||
      packageName === 'saxen' ||
      packageName === 'tiny-svg'
    ) {
      return 'bpmn-vendor'
    }

    if (
      packageName.startsWith('dmn-') ||
      packageName === 'camunda-dmn-js' ||
      packageName === 'table-js' ||
      packageName === 'feelers' ||
      packageName.startsWith('lezer-feel')
    ) {
      return 'bpmn-vendor'
    }

    if (
      packageName.startsWith('@carbon/') ||
      packageName.startsWith('@floating-ui/') ||
      packageName.startsWith('d3-') ||
      packageName === 'd3' ||
      packageName === 'inferno'
    ) {
      return 'carbon-vendor'
    }

    if (packageName.startsWith('@tanstack/')) {
      return 'tanstack-vendor'
    }

    if (
      packageName === 'react' ||
      packageName === 'react-dom' ||
      packageName === 'react-router' ||
      packageName === 'react-router-dom' ||
      packageName === 'scheduler'
    ) {
      return 'react-vendor'
    }

    if (
      packageName === 'lucide-react' ||
      packageName === 'react-icons'
    ) {
      return 'icons-vendor'
    }

    return `vendor-${normalizedName}`
  }

  const require = createRequire(import.meta.url)
  let proxyPatterns = [
    '^/t/[^/]+/api',
    '^/t/[^/]+/engines-api',
    '^/t/[^/]+/starbase-api',
    '^/t/[^/]+/mission-control-api',
    '^/t/[^/]+/git-api',
    '^/t/[^/]+/vcs-api',
    '^/t/[^/]+/health',
    '/api',
    '/engines-api',
    '/starbase-api',
    '/mission-control-api',
    '/git-api',
    '/vcs-api',
    '/health',
  ]
  try {
    const proxyConfig = require('@enterpriseglue/frontend-host/proxy-routes.json') as {
      proxyPatterns: string[]
    }
    if (proxyConfig?.proxyPatterns?.length) {
      proxyPatterns = proxyConfig.proxyPatterns
    }
  } catch (error) {
    console.warn('Using fallback proxy routes (proxy-routes.json not found).')
  }
  const proxyRoutes = Object.fromEntries(
    proxyPatterns.map((pattern) => [
      pattern,
      { target: proxyTarget, changeOrigin: true },
    ]),
  )

  // Expose feature flags to frontend via import.meta.env
  const multiTenant = (globalThis as any).process?.env?.MULTI_TENANT

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@src': path.resolve(__dirname, '../packages/frontend-host/src'),
        // Source alias so frontend can reuse narrow shared utilities without
        // requiring a shared package build in dev/test. Mirrors the existing
        // contracts path alias in packages/frontend-host/tsconfig.json.
        '@enterpriseglue/shared/utils/starbase-filenames.js': path.resolve(__dirname, '../packages/shared/src/utils/starbase-filenames.ts'),
        inferno: path.resolve(__dirname, '../node_modules/dmn-js-shared/node_modules/inferno'),
        'inferno-vnode-flags': path.resolve(__dirname, '../node_modules/dmn-js-shared/node_modules/inferno-vnode-flags'),
      },
    },
    esbuild: {
      jsxDev: mode !== 'production',
    },
    build: {
      chunkSizeWarningLimit: 1500,
      rollupOptions: {
        output: {
          manualChunks,
        },
      },
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development'),
      // Expose MULTI_TENANT to frontend (same name as backend for consistency)
      ...(multiTenant !== undefined && {
        'import.meta.env.MULTI_TENANT': JSON.stringify(multiTenant),
      }),
    },
    server: {
      port: 5173,
      headers: {
        // Allow eval in development (removes CSP warning)
        // Allow Carbon Design System fonts from IBM CDN + data URIs for embedded fonts
        // Allow API calls to backend on localhost:8787
        // Allow images including data URIs (inline SVGs)
        'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://1.www.s81c.com; font-src 'self' data: https://fonts.gstatic.com https://1.www.s81c.com; img-src 'self' data: blob: https:; connect-src 'self' http://localhost:8787;",
      },
      proxy: proxyRoutes,
    },
    preview: {
      proxy: proxyRoutes,
    },
  }
})
