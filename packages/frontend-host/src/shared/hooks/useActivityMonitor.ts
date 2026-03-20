/**
 * Activity Monitor Hook
 * Tracks user activity and triggers callback after inactivity period
 */

import { useEffect, useRef } from 'react';

const LAST_ACTIVITY_KEY = 'eg.auth.lastActivityAt';

interface UseActivityMonitorOptions {
  /**
   * Inactivity timeout in milliseconds
   * @default 3600000 (60 minutes)
   */
  timeoutMs?: number;
  
  /**
   * Callback to execute when user is inactive for the specified duration
   */
  onInactive: () => void;
  
  /**
   * Whether to enable activity monitoring
   * @default true
   */
  enabled?: boolean;
}

/**
 * Hook to monitor user activity and trigger callback after inactivity
 * 
 * Tracks: mouse movement, clicks, keyboard input, touch events, scroll
 * 
 * @example
 * ```tsx
 * useActivityMonitor({
 *   timeoutMs: 60 * 60 * 1000, // 60 minutes
 *   onInactive: () => logout(),
 *   enabled: isAuthenticated
 * });
 * ```
 */
export function useActivityMonitor({
  timeoutMs = 60 * 60 * 1000, // Default: 60 minutes
  onInactive,
  enabled = true,
}: UseActivityMonitorOptions) {
  const timeoutIdRef = useRef<number | null>(null);
  const lastActivityRef = useRef<number>(Date.now());

  const syncActivity = (timestamp: number) => {
    try {
      localStorage.setItem(LAST_ACTIVITY_KEY, String(timestamp));
    } catch {
    }
  };

  const scheduleTimeout = (timestamp: number) => {
    if (timeoutIdRef.current) {
      clearTimeout(timeoutIdRef.current);
    }
    lastActivityRef.current = timestamp;
    timeoutIdRef.current = window.setTimeout(() => {
      console.log('User inactive for', timeoutMs / 1000 / 60, 'minutes - triggering logout');
      onInactive();
    }, timeoutMs);
  };

  useEffect(() => {
    if (!enabled) {
      // Clear any existing timeout when disabled
      if (timeoutIdRef.current) {
        clearTimeout(timeoutIdRef.current);
        timeoutIdRef.current = null;
      }
      return;
    }

    /**
     * Reset the inactivity timer
     */
    const resetTimer = () => {
      const now = Date.now();
      scheduleTimeout(now);
      syncActivity(now);
    };

    /**
     * Activity event handler
     */
    const handleActivity = () => {
      // Only reset if enough time has passed (debounce)
      const timeSinceLastActivity = Date.now() - lastActivityRef.current;
      if (timeSinceLastActivity > 1000) { // Debounce: only reset every 1 second
        resetTimer();
      }
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== LAST_ACTIVITY_KEY) return;
      const timestamp = Number(event.newValue);
      if (!Number.isFinite(timestamp) || timestamp <= lastActivityRef.current) return;
      scheduleTimeout(timestamp);
    };

    // Events that indicate user activity
    const events = [
      'mousedown',
      'mousemove',
      'keydown',
      'pointerdown',
      'wheel',
      'scroll',
      'touchstart',
      'click',
      'focus',
    ];

    // Add event listeners
    events.forEach((event) => {
      window.addEventListener(event, handleActivity, { passive: true });
    });

    document.addEventListener('visibilitychange', handleActivity);
    window.addEventListener('storage', handleStorage);

    // Initialize timer
    resetTimer();

    // Cleanup
    return () => {
      if (timeoutIdRef.current) {
        clearTimeout(timeoutIdRef.current);
      }
      events.forEach((event) => {
        window.removeEventListener(event, handleActivity);
      });
      document.removeEventListener('visibilitychange', handleActivity);
      window.removeEventListener('storage', handleStorage);
    };
  }, [enabled, onInactive, timeoutMs]);

  /**
   * Manually reset the activity timer
   */
  const resetActivityTimer = () => {
    const now = Date.now();
    scheduleTimeout(now);
    syncActivity(now);
    
    if (!enabled && timeoutIdRef.current) {
      clearTimeout(timeoutIdRef.current);
      timeoutIdRef.current = null;
    }
  };

  return { resetActivityTimer };
}
