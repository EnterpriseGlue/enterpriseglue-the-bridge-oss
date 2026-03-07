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

// Disable autocomplete globally on all inputs
const disableAutocomplete = () => {
  const processedInputs = new WeakSet<Element>()
  
  const applyAttributes = (input: Element) => {
    // Skip if already processed
    if (processedInputs.has(input)) return
    processedInputs.add(input)
    
    // Use new-password to disable autofill
    input.setAttribute('autocomplete', 'new-password')
    input.setAttribute('data-lpignore', 'true')
    input.setAttribute('data-form-type', 'other')
  }
  
  // Use a simpler observer that only watches for new elements
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === 1) { // Element node
          const element = node as Element
          // Check if it's an input or contains inputs
          if (element.matches('input, textarea, select')) {
            applyAttributes(element)
          }
          element.querySelectorAll('input, textarea, select').forEach(applyAttributes)
        }
      })
    })
  })
  
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  })
  
  // Run immediately for existing elements
  document.querySelectorAll('input, textarea, select').forEach(applyAttributes)
}

// Start observing after a short delay to avoid blocking initial render
setTimeout(disableAutocomplete, 100)

export async function startApp() {
  const enterprisePlugin = await getEnterpriseFrontendPlugin()
  const enterpriseRootChildren = (enterprisePlugin.routes || []) as any[]
  const enterpriseTenantChildren = (enterprisePlugin.tenantRoutes || []) as any[]

  const qc = new QueryClient()
  const routes = createAppRoutes(enterpriseRootChildren, enterpriseTenantChildren)

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <AuthProvider>
          <FeatureFlagsProvider>
            <QueryClientProvider client={qc}>
              <ToastProvider>
                <RouterProvider router={createBrowserRouter(routes)} />
              </ToastProvider>
            </QueryClientProvider>
          </FeatureFlagsProvider>
        </AuthProvider>
      </ErrorBoundary>
    </React.StrictMode>
  )
}


