import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@carbon/styles/css/styles.css'
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

export async function startApp() {
  const enterprisePlugin = await getEnterpriseFrontendPlugin()
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
