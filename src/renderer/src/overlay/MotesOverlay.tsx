// MotesOverlay — a Scan button that sits on top of the game: capture the EverQuest window,
// read the currency list, confirm to store the counts. Held counts and the planner live in the
// Motes tab. A locked overlay is click-through, so the button only works unlocked.

import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import type { CurrencyScanResult } from '@shared/currencyScan'
import { useOverlayChrome } from './useOverlayChrome'
import { OverlayHeader } from './OverlayHeader'

const GOLD = '#d9b25f'
const BUTTON = {
  background: 'rgba(217,178,95,0.2)',
  color: '#f2f2f2',
  border: `1px solid ${GOLD}`,
  borderRadius: 4,
  padding: '4px 10px',
  cursor: 'pointer',
  fontSize: 12
} as const

export default function MotesOverlay(): JSX.Element {
  const { locked, bgAlpha, hovering, toggleLock, onEnter, onLeave, dragRegion, noDrag } =
    useOverlayChrome()
  useEffect(() => {
    void window.eqOverlay.warmCurrencyScan()
  }, [])
  const [scan, setScan] = useState<CurrencyScanResult | null>(null)
  const [status, setStatus] = useState('Open the inventory currency tab, then Scan.')
  const [busy, setBusy] = useState(false)

  const runScan = async (): Promise<void> => {
    setBusy(true)
    setStatus('Scanning…')
    try {
      const r = await window.eqOverlay.scanCurrency()
      setScan(r)
      setStatus(
        r.ok
          ? r.unmatched.length
            ? `${r.unmatched.length} unreadable rows. Rescan (Confirm would store them as 0).`
            : `Read ${Object.keys(r.counts).length} items${r.zeroed.length ? `; ${r.zeroed.length} not listed → 0` : ''}.`
          : r.error === 'eq-window-not-found'
            ? 'No EverQuest window found.'
            : r.error === 'cancelled'
              ? 'Scan stopped.'
              : 'Currency list not found in the game window.'
      )
    } finally {
      setBusy(false)
    }
  }

  const confirm = async (counts: Record<string, number>): Promise<void> => {
    await window.eqOverlay.applyCurrencyScan(counts)
    setScan(null)
    setStatus(`Saved ${new Date().toLocaleTimeString()}. Loot now counts forward.`)
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
      <OverlayHeader
        tag="MOTES"
        title="Currency scan"
        titleColor={GOLD}
        chrome={{ locked, hovering, dragRegion, noDrag, toggleLock }}
      />
      <div style={{ padding: 8, fontSize: 12, overflowY: 'auto', ...noDrag }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
          <button style={BUTTON} disabled={busy} onClick={() => void runScan()} data-testid="motes-overlay-scan">
            Scan
          </button>
          {busy && (
            <button style={BUTTON} onClick={() => void window.eqOverlay.cancelCurrencyScan()} data-testid="motes-overlay-stop">
              Stop
            </button>
          )}
          {scan?.ok && scan.unmatched.length === 0 && (
            <button style={BUTTON} onClick={() => void confirm(scan.counts)} data-testid="motes-overlay-confirm">
              Confirm
            </button>
          )}
        </div>
        <div style={{ color: 'rgba(255,255,255,0.7)', marginBottom: 6 }}>{status}</div>
        {scan?.ok &&
          Object.entries(scan.counts).map(([name, n]) => (
            <div key={name} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{name}</span>
              <span>{n}</span>
            </div>
          ))}
      </div>
    </div>
  )
}
