/**
 * Thin shell entry point — delegates to @enterpriseglue/frontend-host.
 * Vite resolves the package via file: dependency and bundles it.
 */
import { initRuntimeConfig } from '@enterpriseglue/frontend-host/runtimeConfig'
import '../../packages/frontend-host/src/styles/split-pane.css'

// Resolve deployment configuration while the application modules initialize.
// The host still gates API use on validation.
const runtimeConfigReady = initRuntimeConfig()
void runtimeConfigReady.catch(() => undefined)

void import('@enterpriseglue/frontend-host/main').then(({ startApp }) => startApp(runtimeConfigReady))
