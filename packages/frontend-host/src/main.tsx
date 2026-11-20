import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, matchRoutes, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@carbon/styles/css/styles.css'
import '@ibm/plex-sans/css/ibm-plex-sans-default.css'
import '@ibm/plex-sans-arabic/css/ibm-plex-sans-arabic-default.css'
import '@ibm/plex-mono/css/ibm-plex-mono-default.css'
import './styles/carbon-overrides.css'
import './styles/theme.css'
import './styles/pro-sidebar.css'
import './styles/split-pane.css'
import { SkeletonText } from '@carbon/react'

// Feature Flags
import { FeatureFlagsProvider } from './contexts/FeatureFlagsContext'
import { ErrorBoundary } from './shared/components/ErrorBoundary'

// Authentication
import { AuthProvider } from './contexts/AuthContext'
import { useAuth } from './shared/hooks/useAuth'
import { captureRequestSession } from './utils/httpInterceptor'
import { ToastProvider } from './shared/notifications/ToastProvider'
import { DashboardPrefetch } from './features/dashboard/DashboardPrefetch'
import { tenantSlugForPath } from './features/organizations/organizationPaths'

// Routes
import { APP_ROOT_ROUTE_ID, createAppRoutes, TENANT_LAYOUT_ROUTE_ID } from './routes'

import { getEnterpriseFrontendPlugin } from './enterprise/loadEnterpriseFrontendPlugin'
import { extensions } from './enterprise/extensionRegistry'
import { loadTrustedSystemFrontendModules } from './enterprise/trustedSystemFrontendModules'
import {
  getNativePluginRoutesV1,
  loadInstalledNativePluginsV1,
  NativePluginsReadyContext,
} from './plugins/nativePluginRuntime'
import { HostContextualFlowProviderV1 } from './plugins/contextualFlowRuntime'
import { getConfiguredSystemFrontendModules, initRuntimeConfig } from './runtimeConfig'
import { getTenancyCapabilities, initializeTenancyCapabilities } from './services/tenancy'

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

  const initialPath = window.location.pathname
  const initialSlug = tenantSlugForPath(initialPath)
  const initialDashboard = initialSlug && (initialPath === `/t/${initialSlug}` || initialPath === `/t/${initialSlug}/`)
    ? initialSlug
    : undefined
  let nativeRouteLoad: Promise<void> | undefined
  let publishedNativeSession: string | undefined
  const tenancyReady = (async () => {
    await getEnterpriseFrontendPlugin()
    await loadTrustedSystemFrontendModules(getConfiguredSystemFrontendModules())
    await initializeTenancyCapabilities()
  })()
  const router = tenancyReady.then(async () => {
    const deferNativePlugins = Boolean(initialDashboard && getTenancyCapabilities().mode === 'pooled')
    if (!deferNativePlugins) await loadInstalledNativePluginsV1()
    const routes = createAppRoutes(
      [...extensions.rootRoutes],
      [...extensions.tenantRoutes],
      deferNativePlugins ? [] : getNativePluginRoutesV1('root'),
      deferNativePlugins ? [] : getNativePluginRoutesV1('tenant'),
    )
    const appRouter = createBrowserRouter(routes, deferNativePlugins ? {
      async patchRoutesOnNavigation({ path }) {
        // Built-in pages can open immediately. An unresolved deep link can
        // still be matched against native routes that are being registered.
        const matches = matchRoutes(routes, path)
        const route = matches?.[matches.length - 1]?.route
        if (!route || route.path?.includes('*')) await nativeRouteLoad
      },
    } : undefined)
    return { appRouter, deferNativePlugins }
  })
  const qc = new QueryClient()
  const hasExplicitTenant = /^\/t\/[^/]+(?:\/|$)/.test(window.location.pathname)

  function DeferredNativeRoutes({ appRouter }: { appRouter: ReturnType<typeof createBrowserRouter> }) {
    const { user, permissions, isLoading, sessionRevision } = useAuth()
    const tenantSlug = React.useSyncExternalStore(
      appRouter.subscribe, () => tenantSlugForPath(appRouter.state.location.pathname),
    )
    const verifiedTenantSlug = user?.session?.tenant.slug
    const [ready, setReady] = React.useState(false)
    React.useEffect(() => {
      if (ready || isLoading || !tenantSlug || tenantSlug !== verifiedTenantSlug) return
      let cancelled = false
      const session = captureRequestSession()
      nativeRouteLoad = loadInstalledNativePluginsV1({
        tenantSlug,
        isCurrent: session.isCurrent,
        isPublished: () => publishedNativeSession === session.key,
      }).then(() => {
        if (cancelled || !session.isCurrent()) return
        appRouter.patchRoutes(APP_ROOT_ROUTE_ID, getNativePluginRoutesV1('root'))
        appRouter.patchRoutes(TENANT_LAYOUT_ROUTE_ID, getNativePluginRoutesV1('tenant'))
        publishedNativeSession = session.key
        setReady(true)
      }).catch(() => {
        // A newer verified session owns the next attempt for an abandoned scope.
        if (!cancelled && session.isCurrent()) console.error('[Plugin runtime] Deferred frontend routes could not be registered')
      })
      return () => { cancelled = true }
    }, [appRouter, isLoading, permissions, ready, sessionRevision, tenantSlug, verifiedTenantSlug])

    return (
      <NativePluginsReadyContext.Provider value={ready}>
        <RouterProvider router={appRouter} />
      </NativePluginsReadyContext.Provider>
    )
  }

  function AppRouter() {
    const { appRouter, deferNativePlugins } = React.use(router)
    return deferNativePlugins ? <DeferredNativeRoutes appRouter={appRouter} /> : <RouterProvider router={appRouter} />
  }

  function AppSession() {
    // Unprefixed routes need the tenancy mode to resolve their authentication
    // scope. An explicit tenant can restore its session during bootstrap.
    if (!hasExplicitTenant) React.use(tenancyReady)
    return (
      <AuthProvider>
        {initialDashboard && <DashboardPrefetch tenantSlug={initialDashboard} />}
        <FeatureFlagsProvider>
          <ToastProvider>
            <HostContextualFlowProviderV1>
              <React.Suspense fallback={<SkeletonText paragraph lineCount={4} />}>
                <AppRouter />
              </React.Suspense>
            </HostContextualFlowProviderV1>
          </ToastProvider>
        </FeatureFlagsProvider>
      </AuthProvider>
    )
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <QueryClientProvider client={qc}>
          <React.Suspense fallback={<SkeletonText paragraph lineCount={4} />}>
            <AppSession />
          </React.Suspense>
        </QueryClientProvider>
      </ErrorBoundary>
    </React.StrictMode>
  )
}
