// ScanPreview — what the last scan read. A scan that read every row is already saved; one with an
// unreadable row saved nothing. Only motes are shown; runes are scanned and saved but not listed.

import type { JSX } from 'react'
import { Alert, Typography } from '@mui/material'
import type { CurrencyScanError, CurrencyScanResult } from '@shared/currencyScan'
import { MOTES } from '@shared/planner/motes'
import { shortMote } from './usePlanner'

const ERRORS: Record<CurrencyScanError, string> = {
  cancelled: 'Scan stopped.',
  'eq-window-not-found': 'No EverQuest window found. Is the game running?',
  'eq-minimized': 'EverQuest is minimized. Restore it; it can stay behind other windows.',
  'not-currency-window':
    'Could not find the currency list. Open the inventory currency tab in game and try again.'
}

/** One line on what a scan did, shared by the tab and the overlay. */
export function scanSummary(result: CurrencyScanResult): string {
  if (!result.ok) return ERRORS[result.error]
  if (!result.saved) return `Not saved: ${result.unmatched.length} unreadable row(s). Rescan.`
  return `Saved ${new Date().toLocaleTimeString()}. Loot now counts forward.`
}

export function ScanPreview(props: { result: CurrencyScanResult; onClose: () => void }): JSX.Element {
  const { result } = props
  if (!result.ok || !result.saved) {
    return (
      <Alert severity="warning" onClose={props.onClose} sx={{ my: 1 }}>
        {scanSummary(result)}
        {result.ok && (
          <Typography variant="body2" sx={{ mt: 1 }}>
            Unreadable: {result.unmatched.join(', ')}
          </Typography>
        )}
      </Alert>
    )
  }
  const motes = MOTES.filter((m) => m.name in result.counts).map((m) => `${shortMote(m.name)} ${result.counts[m.name]}`)
  return (
    <Alert severity="success" onClose={props.onClose} sx={{ my: 1 }} data-testid="motes-scan-preview">
      {scanSummary(result)} Read: {motes.join(', ')}.
    </Alert>
  )
}
