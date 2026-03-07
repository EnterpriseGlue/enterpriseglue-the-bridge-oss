/**
 * Thin shell entry point — delegates to @enterpriseglue/frontend-host.
 * Vite resolves the package via file: dependency and bundles it.
 */
import { startApp } from '@enterpriseglue/frontend-host/main'
import '../../packages/frontend-host/src/styles/split-pane.css'

startApp()
