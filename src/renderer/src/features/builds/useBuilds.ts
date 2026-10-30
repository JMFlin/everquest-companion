// useBuilds — the Builds payload and the selected build, for the tab and the overlay alike.
//
// The selection and the compare target are localStorage keys, so the tab's dropdown and the overlay's (separate windows,
// same origin) stay on the same build: a `storage` event fires in the other window on every change.
// The payload is re-read on mount, on Reload, and whenever a dump is re-read or the character
// changes — the caller passes whichever of those pushes its bridge has.

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  compareBuild,
  compareKey,
  wornFor,
  type Build,
  type BuildsPayload,
  type CompareRow,
  type WornDump
} from '@shared/builds'

const SELECTED_KEY = 'builds.selected'
const TARGET_KEY = 'builds.compareWith'

export interface BuildsBridge {
  getBuilds: () => Promise<BuildsPayload>
  /** pushes after which the payload is stale (dump re-read, character switch) */
  subscribe: (reload: () => void) => () => void
}

export interface BuildsState {
  payload: BuildsPayload | null
  selected: Build | null
  select: (id: string) => void
  /** the `compareKey` in effect: a loadout key, or `newest` for a dump no `/who` named */
  target: string
  setTarget: (target: string) => void
  /** the dump the selected build is compared against; null when that dump does not exist */
  worn: WornDump | null
  reload: () => void
  /** the selected build against the body (every cell differs when there is no dump); null without a build */
  rows: CompareRow[] | null
}

export function useBuilds(bridge: BuildsBridge): BuildsState {
  const [payload, setPayload] = useState<BuildsPayload | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(() => localStorage.getItem(SELECTED_KEY))
  const [target, setTargetState] = useState<string>(() => localStorage.getItem(TARGET_KEY) ?? 'auto')
  const { getBuilds, subscribe } = bridge

  const reload = useCallback(() => void getBuilds().then(setPayload), [getBuilds])
  useEffect(() => {
    reload()
    return subscribe(reload)
  }, [reload, subscribe])

  useEffect(() => {
    const onStorage = (e: StorageEvent): void => {
      if (e.key === SELECTED_KEY) setSelectedId(e.newValue)
      if (e.key === TARGET_KEY) setTargetState(e.newValue ?? 'auto')
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const setTarget = useCallback((next: string) => {
    localStorage.setItem(TARGET_KEY, next)
    setTargetState(next)
  }, [])

  // A newly picked build opens on its own loadout again.
  const select = useCallback(
    (id: string) => {
      localStorage.setItem(SELECTED_KEY, id)
      setSelectedId(id)
      setTarget('auto')
    },
    [setTarget]
  )

  const selected = payload?.builds.find((b) => b.id === selectedId) ?? payload?.builds[0] ?? null
  const key = payload === null || selected === null ? 'newest' : compareKey(payload, selected, target)
  const worn = payload === null ? null : wornFor(payload, key)
  const rows = useMemo(() => (selected === null ? null : compareBuild(selected, worn?.cells ?? {})), [selected, worn])
  return { payload, selected, select, target: key, setTarget, worn, reload, rows }
}
