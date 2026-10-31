// MotesOverlay — the Motes tab on top of the game: Scan (saved at once when every row reads),
// held motes, and the same upgrade planner. Held counts and planner state come from the shared
// features/motes modules; this file only draws them in plain divs. A locked overlay is
// click-through, so its buttons only work unlocked.

import type { CSSProperties, JSX, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CurrencyScanResult } from '@shared/currencyScan'
import type { ItemCountOverride } from '@shared/itemOverrides'
import { MOTES, SPARE_MAX_TIER, stepGroups, type SectionPlan } from '@shared/planner/motes'
import type { LootSnap } from '@shared/types'
import { heldMotes } from '../features/motes/heldMotes'
import { scanSummary } from '../features/motes/ScanPreview'
import { useAutoRescan } from '../features/motes/useAutoRescan'
import { RANKS, groupTitle, inPick, outcomeText, pickLabel, shortMote, stepText, usePlanner, type RankPick } from '../features/motes/usePlanner'
import { useOverlayChrome } from './useOverlayChrome'
import { useOverlayModule } from './useOverlayModule'
import { OverlayHeader } from './OverlayHeader'

const GOLD = '#d9b25f'
const DIM = 'rgba(255,255,255,0.6)'
const NO_LOOT: LootSnap = []
const SPARE_TIERS = Array.from({ length: SPARE_MAX_TIER + 1 }, (_, t) => t)

const button = (lit = false): CSSProperties => ({
  background: lit ? 'rgba(217,178,95,0.55)' : 'rgba(217,178,95,0.15)',
  color: '#f2f2f2',
  border: `1px solid ${lit ? GOLD : 'rgba(217,178,95,0.4)'}`,
  borderRadius: 3,
  padding: '1px 5px',
  cursor: 'pointer',
  fontSize: 11
})

/** The statements the held counts start from; re-read when a scan is saved or the character changes. */
function useHeldStatements(): ItemCountOverride[] {
  const [statements, setStatements] = useState<ItemCountOverride[]>([])
  const reload = useCallback(() => void window.eqOverlay.getHeldStatements().then(setStatements), [])
  useEffect(() => {
    reload()
    const offSaved = window.eqOverlay.onHeldStatements(reload)
    const offChar = window.eqOverlay.onCharacter(reload)
    return () => {
      offSaved()
      offChar()
    }
  }, [reload])
  return statements
}

function Picker(props: { label: string; pick: RankPick; onPick: (n: number) => void }): JSX.Element {
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ width: 36 }}>{props.label}</span>
        {RANKS.map((n) => (
          <button key={n} style={button(inPick(props.pick, n))} onClick={() => props.onPick(n)}>
            {n}
          </button>
        ))}
      </div>
      <div style={{ color: DIM, paddingLeft: 38 }}>{pickLabel(props.pick)}</div>
    </div>
  )
}

function Steps({ plan }: { plan: SectionPlan }): JSX.Element {
  const outcome = outcomeText(plan)
  return (
    <div style={{ paddingLeft: 38 }}>
      {stepGroups(plan.steps).map((g, gi) => (
        <div
          key={gi}
          style={g.kind === 'all' ? undefined : { borderLeft: `2px solid ${g.kind === 'main' ? GOLD : 'rgba(255,255,255,0.25)'}`, paddingLeft: 6, marginBottom: 4 }}
        >
          {g.kind !== 'all' && <div style={{ color: g.kind === 'main' ? GOLD : DIM, fontWeight: 600 }}>{groupTitle(g)}</div>}
          {g.steps.map((s, i) => (
            <div key={i}>{stepText(s)}</div>
          ))}
        </div>
      ))}
      <div style={{ color: outcome.ok ? '#8fd18f' : '#e0b050' }}>{outcome.text}</div>
    </div>
  )
}

function Check(props: { checked: boolean; onChange: (c: boolean) => void; testId: string; children: ReactNode }): JSX.Element {
  return (
    <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
        data-testid={props.testId}
      />
      {props.children}
    </label>
  )
}

/** "Progress at +N: [ x ] / 2^N" — XP already banked toward the next rank or tier. */
function ProgressPlain(props: { from: number; fraction: number; onFraction: (f: number) => void }): JSX.Element {
  const step = 2 ** props.from
  return (
    <div>
      Progress at +{props.from}:{' '}
      <input
        type="number"
        min={0}
        max={step - 1}
        value={props.fraction}
        onChange={(e) => props.onFraction(Math.min(step - 1, Math.max(0, Math.floor(Number(e.target.value) || 0))))}
        style={{ width: 48, fontSize: 11 }}
      />{' '}
      / {step}
    </div>
  )
}

function GearExtrasPlain(props: {
  from: number
  fraction: number
  onFraction: (f: number) => void
  spares: number[]
  onSpares: (s: number[]) => void
}): JSX.Element {
  return (
    <div style={{ paddingLeft: 38 }}>
      <ProgressPlain from={props.from} fraction={props.fraction} onFraction={props.onFraction} />
      <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', marginTop: 2 }}>
        <span>Spare copy:</span>
        {SPARE_TIERS.map((t) => (
          <button key={t} style={button()} onClick={() => props.onSpares([...props.spares, t])}>
            +{t}
          </button>
        ))}
      </div>
      {props.spares.length > 0 && (
        <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', marginTop: 2 }}>
          {props.spares.map((t, i) => (
            <button key={i} style={button(true)} onClick={() => props.onSpares(props.spares.filter((_, j) => j !== i))}>
              +{t} ✕
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function MotesOverlay(): JSX.Element {
  const { locked, bgAlpha, hovering, toggleLock, onEnter, onLeave, dragRegion, noDrag } = useOverlayChrome()
  const loot = useOverlayModule<LootSnap>('loot', NO_LOOT)
  const statements = useHeldStatements()
  const held = useMemo(() => heldMotes(loot, statements), [loot, statements])
  const p = usePlanner(held)
  const auto = useAutoRescan(window.eqOverlay)
  useEffect(() => {
    void window.eqOverlay.warmCurrencyScan()
  }, [])

  const [status, setStatus] = useState('Open the inventory currency tab, then Scan.')
  const [busy, setBusy] = useState(false)
  const runScan = async (): Promise<void> => {
    setBusy(true)
    setStatus('Scanning…')
    try {
      const r: CurrencyScanResult = await window.eqOverlay.scanCurrency()
      setStatus(scanSummary(r))
    } finally {
      setBusy(false)
    }
  }

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
      <OverlayHeader tag="MOTES" title="Motes" titleColor={GOLD} chrome={{ locked, hovering, dragRegion, noDrag, toggleLock }} />
      <div style={{ padding: 8, fontSize: 11, overflowY: 'auto', ...noDrag }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button style={button()} disabled={busy} onClick={() => void runScan()} data-testid="motes-overlay-scan">
            Scan
          </button>
          {busy && (
            <button style={button()} onClick={() => void window.eqOverlay.cancelCurrencyScan()} data-testid="motes-overlay-stop">
              Stop
            </button>
          )}
          <span style={{ color: DIM }}>{status}</span>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 4 }}>
          <Check checked={auto.enabled} onChange={auto.setEnabled} testId="motes-overlay-auto-rescan">
            Auto rescan
            {auto.countdown && <span style={{ color: DIM }}>· {auto.countdown}</span>}
            {auto.note && <span style={{ color: '#8fd18f' }}>· {auto.note}</span>}
          </Check>
          <Check checked={p.condense} onChange={p.setCondense} testId="motes-overlay-condense">
            Condense motes
          </Check>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', columnGap: 12, margin: '6px 0' }}>
          {MOTES.map((m) => (
            <div key={m.name} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{shortMote(m.name)}</span>
              <span>{held[m.name]}</span>
            </div>
          ))}
        </div>
        <Picker label="Spell" pick={p.spell} onPick={p.pickSpell} />
        {p.spell.sel && (
          <div style={{ paddingLeft: 38 }}>
            <ProgressPlain from={p.spell.sel.from} fraction={p.spellFraction} onFraction={p.setSpellFraction} />
          </div>
        )}
        {p.plan.spell && <Steps plan={p.plan.spell} />}
        <Picker label="Gear" pick={p.gear} onPick={p.pickGear} />
        {p.gear.sel && (
          <GearExtrasPlain
            from={p.gear.sel.from}
            fraction={p.fraction}
            onFraction={p.setFraction}
            spares={p.spares}
            onSpares={p.setSpares}
          />
        )}
        {p.plan.gear && <Steps plan={p.plan.gear} />}
      </div>
    </div>
  )
}
