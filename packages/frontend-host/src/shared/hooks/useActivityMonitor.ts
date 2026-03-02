/**
 * Activity Monitor Hook
 * Tracks user activity and triggers callback after inactivity period
 */

import { useEffect, useRef } from 'react';

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
      // Clear existing timeout
      if (timeoutIdRef.current) {
        clearTimeout(timeoutIdRef.current);
      }

      // Update last activity timestamp
      lastActivityRef.current = Date.now();

      // Set new timeout
      timeoutIdRef.current = window.setTimeout(() => {
        console.log('User inactive for', timeoutMs / 1000 / 60, 'minutes - triggering logout');
        onInactive();
      }, timeoutMs);
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

    // Events that indicate user activity
    const events = [
      'mousedown',
      'mousemove',
      'keydown',
      'scroll',
      'touchstart',
      'click',
    ];

    // Add event listeners
    events.forEach((event) => {
      window.addEventListener(event, handleActivity, { passive: true });
    });

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
    };
  }, [enabled, onInactive, timeoutMs]);

  /**
   * Manually reset the activity timer
   */
  const resetActivityTimer = () => {
    if (timeoutIdRef.current) {
      clearTimeout(timeoutIdRef.current);
    }
    lastActivityRef.current = Date.now();
    
    if (enabled) {
      timeoutIdRef.current = window.setTimeout(() => {
        console.log('User inactive - triggering logout');
        onInactive();
      }, timeoutMs);
    }
  };

  return { resetActivityTimer };
}
