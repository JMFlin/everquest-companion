// GearExtras — what the gear plan knows beyond from → to: XP already banked at the current tier
// (the in-game "x / y", 0 unless set) and spare copies of the same item to merge in.

import type { JSX } from 'react'
import { Box, Chip, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { SPARE_MAX_TIER } from '@shared/planner/motes'

const SPARE_TIERS = Array.from({ length: SPARE_MAX_TIER + 1 }, (_, t) => t)

export function GearExtras(props: {
  from: number
  fraction: number
  onFraction: (fraction: number) => void
  spares: readonly number[]
  onSpares: (spares: number[]) => void
}): JSX.Element {
  const { from, fraction, spares } = props
  const step = 2 ** from
  return (
    <Box sx={{ pl: 9 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="body2">Progress at +{from}:</Typography>
        <TextField
          size="small"
          type="number"
          value={fraction}
          onChange={(e) => props.onFraction(Math.min(step - 1, Math.max(0, Math.floor(Number(e.target.value) || 0))))}
          slotProps={{ htmlInput: { min: 0, max: step - 1, 'data-testid': 'motes-gear-fraction' } }}
          sx={{ width: 90 }}
        />
        <Typography variant="body2">/ {step}</Typography>
      </Stack>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="body2">Add a spare copy:</Typography>
        <ToggleButtonGroup size="small" data-testid="motes-gear-spares">
          {SPARE_TIERS.map((t) => (
            <ToggleButton key={t} value={t} selected={false} onClick={() => props.onSpares([...spares, t])}>
              +{t}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Stack>
      {spares.length > 0 && (
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          <Typography variant="body2">Spare copies:</Typography>
          {spares.map((t, i) => (
            <Chip
              key={i}
              size="small"
              label={`+${t} (${2 ** t} XP)`}
              onDelete={() => props.onSpares(spares.filter((_, j) => j !== i))}
            />
          ))}
        </Stack>
      )}
    </Box>
  )
}
