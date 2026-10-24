// ScanPreview — what the OCR read, shown before anything is stored. Confirm states every count.

import type { JSX } from 'react'
import { Alert, Button, Stack, Typography } from '@mui/material'
import type { CurrencyScanResult } from '@shared/currencyScan'

const ERRORS: Record<'eq-window-not-found' | 'not-currency-window', string> = {
  'eq-window-not-found': 'No EverQuest window found. Is the game running?',
  'not-currency-window':
    'Could not find the currency list (Name / Expansion / Quantity). Open the inventory currency tab and try again.'
}

export function ScanPreview(props: {
  result: CurrencyScanResult
  onConfirm: (counts: Record<string, number>) => void
  onCancel: () => void
}): JSX.Element {
  const { result } = props
  if (!result.ok) {
    return (
      <Alert severity="warning" onClose={props.onCancel}>
        {ERRORS[result.error]}
      </Alert>
    )
  }
  const entries = Object.entries(result.counts)
  return (
    <Alert severity="success" data-testid="motes-scan-preview" sx={{ my: 1 }}>
      <Typography variant="body2" sx={{ mb: 1 }}>
        Read {entries.length} items. Confirm to set these as your held counts.
      </Typography>
      <Typography variant="body2" sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        {entries.map(([name, n]) => `${name}: ${n}`).join('\n')}
      </Typography>
      {result.zeroed.length > 0 && (
        <Typography variant="body2" sx={{ mt: 1 }}>
          Not in the window, will be set to 0: {result.zeroed.join(', ')}
        </Typography>
      )}
      {result.unmatched.length > 0 && (
        <Typography variant="body2" color="warning.main" sx={{ mt: 1 }}>
          Unreadable rows: {result.unmatched.join(', ')}. Confirm is off: an unreadable row would
          be stored as 0. Rescan.
        </Typography>
      )}
      <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
        <Button
          size="small"
          variant="contained"
          disabled={result.unmatched.length > 0}
          onClick={() => props.onConfirm(result.counts)}
        >
          Confirm
        </Button>
        <Button size="small" onClick={props.onCancel}>
          Cancel
        </Button>
      </Stack>
    </Alert>
  )
}
