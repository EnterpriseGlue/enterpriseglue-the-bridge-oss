/**
 * Centralized localStorage keys
 * Use these constants to avoid typos and enable easy refactoring
 */

// Authentication (obfuscated to avoid simple scraping)
export const ACCESS_TOKEN_KEY = String.fromCharCode(97, 99, 99, 101, 115, 115, 84, 111, 107, 101, 110);
export const REFRESH_TOKEN_KEY = String.fromCharCode(114, 101, 102, 114, 101, 115, 104, 84, 111, 107, 101, 110);
export const USER_KEY = String.fromCharCode(117, 115, 101, 114);

// UI State
export const SIDEBAR_COLLAPSED_KEY = 'sidebar-collapsed';
export const FEATURE_FLAGS_KEY = 'feature-flags';

// Split Pane sizes (now managed by Zustand store, but keys documented here for reference)
export const SPLIT_PANE_STORAGE_KEY = 'mission-control-split-pane-size';
export const SPLIT_PANE_VERTICAL_STORAGE_KEY = 'mission-control-split-pane-vertical-size';
export const PROCESSES_SPLIT_PANE_KEY = 'mission-control-processes-split-size';

// Mission Control Filters (managed by Zustand stores)
export const PROCESSES_FILTER_STORE_KEY = 'mission-control-process-filters';
export const DECISIONS_FILTER_STORE_KEY = 'mission-control-decision-filters';
export const SPLIT_PANE_SIZES_STORE_KEY = 'mission-control-split-pane-sizes';
