'use client';

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'deepwatch:predict-dismissed';
const STORAGE_VERSION = 1;

interface DismissedPayload {
  v: number;
  keys: string[];
}

/**
 * Tracks which fully-settled positions the user has hidden from the
 * popover / overview panel.
 *
 * Key shape mirrors the per-row React keys used in PositionsPopover and
 * PositionsPanel — for binary positions it's
 * `${oracle_id}|${strike}|${is_up}` and for ranges it's
 * `${oracle_id}|${expiry}|${lower_strike}|${higher_strike}`. Storing a
 * stable key (rather than the position's indexer id) means a dismissed
 * row stays dismissed even if the indexer's row order changes.
 *
 * The dismissal list is persisted to localStorage so users don't lose
 * their cleaned-up view on refresh. A `restoreAll()` call clears the
 * list. The data shape is versioned so we can migrate later without
 * breaking old users.
 */
export function useDismissedPositions() {
  // Lazy initialiser so the SSR pass doesn't touch `window`.
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set()
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (!raw) return new Set()
      const parsed = JSON.parse(raw) as DismissedPayload | string[]
      if (Array.isArray(parsed)) {
        // Legacy shape: plain string array (pre-versioning).
        return new Set(parsed.filter((k): k is string => typeof k === 'string'))
      }
      if (parsed && typeof parsed === 'object' && parsed.v === STORAGE_VERSION) {
        return new Set(parsed.keys.filter((k): k is string => typeof k === 'string'))
      }
      return new Set()
    } catch {
      return new Set()
    }
  })

  // Sync to localStorage on every change. Effect runs after commit, so
  // initial render uses the lazy value above.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const payload: DismissedPayload = { v: STORAGE_VERSION, keys: [...dismissed] }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    } catch {
      // localStorage may be unavailable (private mode, quota) — fail
      // silently. The in-memory Set still works for the session.
    }
  }, [dismissed])

  const dismiss = useCallback((key: string) => {
    setDismissed((prev) => {
      if (prev.has(key)) return prev
      const next = new Set(prev)
      next.add(key)
      return next
    })
  }, [])

  const restore = useCallback((key: string) => {
    setDismissed((prev) => {
      if (!prev.has(key)) return prev
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }, [])

  const restoreAll = useCallback(() => {
    setDismissed(new Set())
  }, [])

  return { dismissed, dismiss, restore, restoreAll, count: dismissed.size }
}
