import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@carbon/styles/css/styles.css'
import '@ibm/plex-sans/css/ibm-plex-sans-default.css'
import '@ibm/plex-sans-arabic/css/ibm-plex-sans-arabic-default.css'
import '@ibm/plex-mono/css/ibm-plex-mono-default.css'
import './styles/carbon-overrides.css'
import './styles/theme.css'
import './styles/pro-sidebar.css'
import './styles/split-pane.css'

// Feature Flags
import { FeatureFlagsProvider } from './contexts/FeatureFlagsContext'
import { ErrorBoundary } from './shared/components/ErrorBoundary'

// Authentication
import { AuthProvider } from './contexts/AuthContext'
import { ToastProvider } from './shared/notifications/ToastProvider'

// Routes
import { createAppRoutes } from './routes'

import { getEnterpriseFrontendPlugin } from './enterprise/loadEnterpriseFrontendPlugin'
import {
  getNativePluginRoutesV1,
  loadInstalledNativePluginsV1,
} from './plugins/nativePluginRuntime'
import { HostContextualFlowProviderV1 } from './plugins/contextualFlowRuntime'
import { initRuntimeConfig } from './runtimeConfig'
import { initializeTenancyCapabilities } from './services/tenancy'

/**
 * Render a minimal, dependency-free error into #root when runtime configuration
 * is required but could not be loaded. Kept out of the React tree so it works
 * even though the app never mounts, and so the non-awaited shell entry point
 * cannot surface an unhandled promise rejection.
 */
function renderRuntimeConfigError(error: unknown): void {
  console.error(
    '[enterpriseglue] Fatal: runtime configuration is required but could not be loaded.',
    error,
  )
  const root = document.getElementById('root')
  if (!root) return

  const message = error instanceof Error ? error.message : String(error)

  const container = document.createElement('div')
  container.setAttribute('role', 'alert')
  container.style.cssText =
    'font-family: system-ui, -apple-system, sans-serif; max-width: 40rem; ' +
    'margin: 4rem auto; padding: 1.5rem 1.75rem; border: 1px solid #da1e28; ' +
    'border-radius: 4px; color: #161616; background: #fff1f1;'

  const heading = document.createElement('h1')
  heading.textContent = 'Application configuration error'
  heading.style.cssText = 'font-size: 1.25rem; margin: 0 0 0.75rem;'

  const body = document.createElement('p')
  body.textContent =
    'The application could not load its runtime configuration and cannot start. ' +
    'Please contact your administrator.'
  body.style.cssText = 'margin: 0 0 1rem; line-height: 1.5;'

  const detail = document.createElement('pre')
  detail.textContent = message
  detail.style.cssText =
    'margin: 0; padding: 0.75rem; background: #fff; border: 1px solid #ffd7d9; ' +
    'border-radius: 4px; white-space: pre-wrap; word-break: break-word; ' +
    'font-size: 0.8125rem;'

  container.append(heading, body, detail)
  root.replaceChildren(container)
}

export async function startApp() {
  // Resolve runtime configuration before anything (plugins, API clients) reads
  // it. Must run ahead of the plugin loads below, which may issue API requests.
  try {
    await initRuntimeConfig()
  } catch (error) {
    renderRuntimeConfigError(error)
    return
  }

  const enterprisePlugin = await getEnterpriseFrontendPlugin()
  await initializeTenancyCapabilities()
  await loadInstalledNativePluginsV1()
  const enterpriseRootChildren = [
    ...((enterprisePlugin.routes || []) as any[]),
  ]
  const enterpriseTenantChildren = [
    ...((enterprisePlugin.tenantRoutes || []) as any[]),
  ]
  const nativePluginRootChildren = getNativePluginRoutesV1('root')
  const nativePluginTenantChildren = getNativePluginRoutesV1('tenant')

  const qc = new QueryClient()
  const routes = createAppRoutes(
    enterpriseRootChildren,
    enterpriseTenantChildren,
    nativePluginRootChildren,
    nativePluginTenantChildren,
  )

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <AuthProvider>
          <FeatureFlagsProvider>
            <QueryClientProvider client={qc}>
              <ToastProvider>
                <HostContextualFlowProviderV1>
                  <RouterProvider router={createBrowserRouter(routes)} />
                </HostContextualFlowProviderV1>
              </ToastProvider>
            </QueryClientProvider>
          </FeatureFlagsProvider>
        </AuthProvider>
      </ErrorBoundary>
    </React.StrictMode>
  )
}
