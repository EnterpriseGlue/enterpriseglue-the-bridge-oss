import { useState, useCallback, useEffect, useRef } from 'react'

export type HistorySnapshot = {
  xml: string
  timestamp: number
  label: string // e.g., "Added Task", "Moved element", etc.
}

type HistoryState = {
  snapshots: HistorySnapshot[]
  currentIndex: number
}

const MAX_HISTORY = 50
const STORAGE_KEY_PREFIX = 'xml-history-'

function getStorageKey(fileId: string) {
  return `${STORAGE_KEY_PREFIX}${fileId}`
}

function loadHistory(fileId: string): HistoryState {
  try {
    const stored = localStorage.getItem(getStorageKey(fileId))
    if (stored) {
      const parsed = JSON.parse(stored)
      if (parsed.snapshots && typeof parsed.currentIndex === 'number') {
        return parsed
      }
    }
  } catch {}
  return { snapshots: [], currentIndex: -1 }
}

function saveHistory(fileId: string, state: HistoryState) {
  try {
    localStorage.setItem(getStorageKey(fileId), JSON.stringify(state))
  } catch (e) {
    // localStorage might be full - remove oldest entries
    console.warn('Failed to save history, clearing old entries', e)
    try {
      const trimmed = {
        ...state,
        snapshots: state.snapshots.slice(-25), // Keep last 25
        currentIndex: Math.min(state.currentIndex, 24)
      }
      localStorage.setItem(getStorageKey(fileId), JSON.stringify(trimmed))
    } catch {}
  }
}

/**
 * Hook for managing persistent XML history with undo/redo support
 */
export function useXmlHistory(fileId: string | undefined) {
  // Load from localStorage synchronously on first render to avoid race conditions
  const [history, setHistory] = useState<HistoryState>(() => {
    if (!fileId) return { snapshots: [], currentIndex: -1 }
    return loadHistory(fileId)
  })
  const initializedRef = useRef(!!fileId)
  const lastSavedXmlRef = useRef<string | null>(null)
  const currentFileIdRef = useRef(fileId)

  // Handle fileId changes (switching between files)
  useEffect(() => {
    if (!fileId) return
    if (fileId === currentFileIdRef.current && initializedRef.current) return
    
    currentFileIdRef.current = fileId
    const loaded = loadHistory(fileId)
    setHistory(loaded)
    initializedRef.current = true
    if (loaded.snapshots.length > 0 && loaded.currentIndex >= 0) {
      lastSavedXmlRef.current = loaded.snapshots[loaded.currentIndex]?.xml || null
    }
  }, [fileId])

  // Save to localStorage whenever history changes
  useEffect(() => {
    if (!fileId || !initializedRef.current) return
    saveHistory(fileId, history)
  }, [fileId, history])

  /**
   * Add a new snapshot to history
   * Call this after each meaningful change
   */
  const addSnapshot = useCallback((xml: string, label: string = 'Change') => {
    // Skip if XML is the same as the last saved
    if (xml === lastSavedXmlRef.current) return
    lastSavedXmlRef.current = xml

    setHistory(prev => {
      // Truncate any "future" snapshots if we're not at the end
      const snapshots = prev.snapshots.slice(0, prev.currentIndex + 1)
      
      // Add new snapshot
      snapshots.push({
        xml,
        timestamp: Date.now(),
        label
      })

      // Limit to MAX_HISTORY
      while (snapshots.length > MAX_HISTORY) {
        snapshots.shift()
      }

      return {
        snapshots,
        currentIndex: snapshots.length - 1
      }
    })
  }, [])

  /**
   * Initialize history with the initial XML (call once when file loads)
   */
  const initializeWithXml = useCallback((xml: string) => {
    setHistory(prev => {
      // Only initialize if empty
      if (prev.snapshots.length > 0) return prev
      lastSavedXmlRef.current = xml
      return {
        snapshots: [{
          xml,
          timestamp: Date.now(),
          label: 'Initial state'
        }],
        currentIndex: 0
      }
    })
  }, [])

  /**
   * Go to a specific snapshot by index
   * Returns the XML to load, or null if invalid
   */
  const goToSnapshot = useCallback((index: number): string | null => {
    if (index < 0 || index >= history.snapshots.length) return null
    const snapshot = history.snapshots[index]
    if (!snapshot) return null
    
    lastSavedXmlRef.current = snapshot.xml
    setHistory(prev => ({ ...prev, currentIndex: index }))
    return snapshot.xml
  }, [history.snapshots])

  /**
   * Undo - go to previous snapshot
   */
  const undo = useCallback((): string | null => {
    if (history.currentIndex <= 0) return null
    return goToSnapshot(history.currentIndex - 1)
  }, [history.currentIndex, goToSnapshot])

  /**
   * Redo - go to next snapshot
   */
  const redo = useCallback((): string | null => {
    if (history.currentIndex >= history.snapshots.length - 1) return null
    return goToSnapshot(history.currentIndex + 1)
  }, [history.currentIndex, history.snapshots.length, goToSnapshot])

  /**
   * Clear all history for this file
   */
  const clearHistory = useCallback(() => {
    if (!fileId) return
    localStorage.removeItem(getStorageKey(fileId))
    setHistory({ snapshots: [], currentIndex: -1 })
    lastSavedXmlRef.current = null
  }, [fileId])

  return {
    snapshots: history.snapshots,
    currentIndex: history.currentIndex,
    canUndo: history.currentIndex > 0,
    canRedo: history.currentIndex < history.snapshots.length - 1,
    addSnapshot,
    initializeWithXml,
    goToSnapshot,
    undo,
    redo,
    clearHistory
  }
}
