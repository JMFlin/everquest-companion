// BuildsOverlay — the Builds tab on top of the game, cut to what you still need: one line per cell
// where you differ from the selected build, the piece to get, and where it comes from. Same
// payload and the same selection as the tab (features/builds/useBuilds), plain divs per the overlay
// bundle's rule. A locked overlay is click-through, so its dropdown only works unlocked.

import type { JSX } from 'react'
import { differingRows, itemNameKey, sourceLines, type CompareRow, type ItemSource } from '@shared/builds'
import { planSlotLabel } from '@shared/planner/types'
import { useBuilds, type BuildsBridge, type BuildsState } from '../features/builds/useBuilds'
import { useOverlayChrome } from './useOverlayChrome'
import { OverlayHeader } from './OverlayHeader'

const GOLD = '#d9b25f'
const YELLOW = '#e0b050'
const DIM = 'rgba(255,255,255,0.6)'

const BRIDGE: BuildsBridge = {
  getBuilds: () => window.eqOverlay.getBuilds(),
  subscribe: (reload) => {
    const offDump = window.eqOverlay.onInventoryReload(reload)
    const offChar = window.eqOverlay.onCharacter(() => reload())
    return () => {
      offDump()
      offChar()
    }
  }
}

function Line({ row, source }: { row: CompareRow; source: ItemSource | null | undefined }): JSX.Element {
  const lines = sourceLines(source ?? null)
  return (
    <div style={{ marginTop: 5 }} data-testid={`builds-overlay-row-${row.cell}`}>
      <div>
        <span style={{ color: DIM, display: 'inline-block', width: 76 }}>{planSlotLabel(row.cell)}</span>
        <span style={{ color: row.differs ? YELLOW : '#f2f2f2', fontWeight: 600 }}>{row.build.name}</span>
      </div>
      <div style={{ paddingLeft: 76, color: DIM }}>{lines.length > 0 ? lines.join(' · ') : 'source unknown'}</div>
      {row.exaltations.map((e) =>
        e.differs ? (
          <div key={e.kind} style={{ paddingLeft: 76, color: YELLOW }}>
            {e.kind}: {e.build}
          </div>
        ) : null
      )}
    </div>
  )
}

function Body({ state }: { state: BuildsState }): JSX.Element {
  const { payload, selected, select, rows } = state
  const differing = rows === null ? [] : differingRows(rows)
  return (
    <>
      {payload !== null && payload.builds.length === 0 && (
        <div style={{ color: DIM }}>No builds yet: see the Builds tab.</div>
      )}
      {payload !== null && payload.builds.length > 0 && (
        <select
          value={selected?.id ?? ''}
          onChange={(e) => select(e.target.value)}
          data-testid="builds-overlay-select"
          style={{
            width: '100%',
            background: '#1b1f25',
            color: '#f2f2f2',
            border: `1px solid ${GOLD}`,
            fontSize: 11
          }}
        >
          {payload.builds.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      )}
      {payload?.worn === null && (
        <div style={{ color: DIM, marginTop: 4 }}>No inventory dump yet: /outputfile inventory</div>
      )}
      {rows !== null && differing.length === 0 && (
        <div style={{ color: '#8fd18f', marginTop: 6 }}>You are wearing this build.</div>
      )}
      {differing.map((r) => (
        <Line key={r.cell} row={r} source={payload?.sources[itemNameKey(r.build.name)]} />
      ))}
    </>
  )
}

export default function BuildsOverlay(): JSX.Element {
  const { locked, bgAlpha, hovering, toggleLock, onEnter, onLeave, dragRegion, noDrag } = useOverlayChrome()
  const state = useBuilds(BRIDGE)

  return (
    <div
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'Inter, "Segoe UI", Roboto, system-ui, sans-serif',
        color: '#f2f2f2',
        background: `rgba(14,17,21,${bgAlpha})`,
        border: locked ? '1px solid rgba(255,255,255,0.04)' : `1px solid rgba(217,178,95,0.4)`,
        borderRadius: 8,
        boxSizing: 'border-box',
        overflow: 'hidden'
      }}
    >
      <OverlayHeader
        tag="BUILDS"
        title="Builds"
        titleColor={GOLD}
        chrome={{ locked, hovering, dragRegion, noDrag, toggleLock }}
      />
      <div style={{ padding: 8, fontSize: 11, overflowY: 'auto', ...noDrag }}>
        <Body state={state} />
      </div>
    </div>
  )
}
