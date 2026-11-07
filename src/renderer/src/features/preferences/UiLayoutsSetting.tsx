// UiLayoutsSetting — the Preferences "Game" section's saved-UI-layouts card (fork feature,
// src/shared/uiLayouts.ts states it). Save the window layout EverQuest is using under a name
// ("Big monitor", "Laptop"), and apply a saved one before playing on the other screen.
//
// Renders nothing until main answers the first list, so it never paints an empty list it has not
// read (the prefsHydration.tsx law, kept locally because the list is not a pref).

import { type JSX, useEffect, useState } from 'react'
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material'
import { UI_LAYOUT_NAME_MAX, type UiLayoutsResult } from '@shared/uiLayouts'
import { formatDateTime } from '../../lib/formatDate'

export function UiLayoutsSetting(): JSX.Element | null {
  const [result, setResult] = useState<UiLayoutsResult | null>(null)
  const [name, setName] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    void window.eq.listUiLayouts().then(setResult)
  }, [])

  const run = async (op: Promise<UiLayoutsResult>, done: string): Promise<void> => {
    const next = await op
    setResult(next)
    setNotice(next.error === undefined ? done : null)
  }

  if (!result) return null
  return (
    <Stack spacing={1.25} data-testid="ui-layouts">
      <Typography variant="body2" color="text.secondary">
        EverQuest keeps one window layout per character. Save one for each screen you play on and
        apply it before you log in. Quit EverQuest first.
      </Typography>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        <TextField
          size="small"
          placeholder="Layout name, e.g. Laptop"
          value={name}
          slotProps={{ htmlInput: { maxLength: UI_LAYOUT_NAME_MAX, 'data-testid': 'ui-layouts-name' } }}
          onChange={(e) => { setName(e.target.value) }}
          sx={{ flexGrow: 1 }}
        />
        <Button
          variant="outlined"
          disabled={name.trim() === ''}
          data-testid="ui-layouts-save"
          onClick={() => void run(window.eq.saveUiLayout(name), `Saved the current layout as "${name.trim()}".`)}
        >
          Save current layout
        </Button>
      </Box>
      {result.layouts.map((l) => (
        <Box
          key={l.name}
          data-testid="ui-layouts-row"
          sx={{ display: 'flex', gap: 1, alignItems: 'center', p: 1, borderRadius: 1, bgcolor: 'action.hover' }}
        >
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="body2">{l.name}</Typography>
            <Typography variant="caption" color="text.secondary">
              Saved {formatDateTime(l.savedAt)} - {l.files.length} UI file{l.files.length === 1 ? '' : 's'}
            </Typography>
          </Box>
          <Button
            size="small"
            variant="contained"
            onClick={() => void run(window.eq.applyUiLayout(l.name), `Applied "${l.name}". Log in to see it.`)}
          >
            Apply
          </Button>
          <Button size="small" color="inherit" onClick={() => void run(window.eq.deleteUiLayout(l.name), `Deleted "${l.name}".`)}>
            Delete
          </Button>
        </Box>
      ))}
      {result.error !== undefined && <Alert severity="warning">{result.error}</Alert>}
      {notice !== null && <Alert severity="success">{notice}</Alert>}
    </Stack>
  )
}
