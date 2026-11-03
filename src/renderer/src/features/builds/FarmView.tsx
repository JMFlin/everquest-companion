// FarmView: the Builds tab's Farm view: for the selected build, how many more copies of each piece
// to farm to reach +7, +8, +9 and +10, and where they drop. The arithmetic and every number here
// come from @shared/buildFarm; this file reads the three inputs (the character's inventory dump,
// the loot log, the held motes) and draws the result.

import { type JSX, useMemo, useState } from 'react'
import {
  Box,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography
} from '@mui/material'
import type { Build, BuildsPayload } from '@shared/builds'
import {
  BOOST_TIER,
  FARM_TIERS,
  farmCells,
  farmTargets,
  farmTotals,
  lootSeen,
  moteSummary,
  ownedCopies,
  type CopyRange,
  type FarmCell,
  type FarmTier,
  type OwnedCopy
} from '@shared/buildFarm'
import { planSlotLabel } from '@shared/planner/types'
import { useCharacterSheet } from '../character/useCharacterSheet'
import { useProgress } from '../posky/useProgress'
import { heldMotes } from '../motes/heldMotes'

function rangeText(r: CopyRange | null): string {
  if (r === null) return '✓'
  return r.lo === r.hi ? String(r.lo) : `${String(r.lo)}-${String(r.hi)}`
}

function sparesText(spares: readonly OwnedCopy[]): string {
  if (spares.length === 0) return 'none'
  const byTier = new Map<number, number>()
  for (const s of spares) byTier.set(s.tier, (byTier.get(s.tier) ?? 0) + 1)
  const tiers = [...byTier]
    .sort((a, b) => b[0] - a[0])
    .map(([t, n]) => (n === 1 ? `+${String(t)}` : `+${String(t)} ×${String(n)}`))
  return `${String(spares.length)} (${tiers.join(', ')})`
}

function sourcesText(c: FarmCell): string {
  if (c.sources.length === 0) return 'source unknown'
  const shown = c.sources
    .slice(0, 2)
    .map((s) => (s.count > 0 ? `${s.label} ×${String(s.count)}` : s.label))
  return c.sources.length > 2 ? `${shown.join('; ')} +${String(c.sources.length - 2)}` : shown.join('; ')
}

function Summary({ cells, motes }: { cells: FarmCell[]; motes: ReturnType<typeof moteSummary> }): JSX.Element {
  const totals = farmTotals(cells)
  return (
    <Paper variant="outlined" sx={{ p: 2 }} data-testid="farm-summary">
      <Stack direction="row" spacing={4} sx={{ mb: 1 }}>
        {FARM_TIERS.map((t) => (
          <Box key={t}>
            <Typography variant="caption" color="text.secondary">
              Copies to farm, every piece to +{t}
            </Typography>
            <Typography variant="h6" data-testid={`farm-total-${String(t)}`}>
              {rangeText(totals[t])}
            </Typography>
          </Box>
        ))}
      </Stack>
      <Typography variant="body2" color="text.secondary">
        Low end: every copy levelled to +{BOOST_TIER} with Major motes before it merges. High end: merged
        as it drops. Your {motes.majors} Majors level about {motes.boostsFrom4} copies dropping at +4, or{' '}
        {motes.boostsFrom0} at +0. Greater-and-up motes ({motes.highXp} XP) go straight onto pieces and are
        not in the counts.
      </Typography>
    </Paper>
  )
}

function CellTable({ cells }: { cells: FarmCell[] }): JSX.Element {
  return (
    <Paper variant="outlined">
      <Table size="small" data-testid="farm-table">
        <TableHead>
          <TableRow>
            <TableCell>Slot</TableCell>
            <TableCell>Item</TableCell>
            <TableCell>Now</TableCell>
            <TableCell>Spares</TableCell>
            <TableCell>Drops at</TableCell>
            {FARM_TIERS.map((t) => (
              <TableCell key={t} align="right">
                +{t}
              </TableCell>
            ))}
            <TableCell>Farm from</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {cells.map((c) => (
            <TableRow key={c.cell} data-testid={`farm-row-${c.cell}`}>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{planSlotLabel(c.cell)}</TableCell>
              <TableCell>
                <Typography variant="body2" fontWeight={600}>
                  {c.item}
                </Typography>
              </TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>
                {c.tier === null ? (
                  <Typography variant="body2" color="warning.main">
                    missing
                  </Typography>
                ) : (
                  `+${String(c.tier)} · ${c.place ?? ''}`
                )}
              </TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{sparesText(c.spares)}</TableCell>
              <TableCell
                sx={{ whiteSpace: 'nowrap', color: c.dropSeen ? undefined : 'text.secondary' }}
                title={c.dropSeen ? 'The tier copies most often looted at' : 'Never looted: assumed +0'}
              >
                +{c.dropTier}
                {c.dropSeen ? '' : '?'}
              </TableCell>
              {FARM_TIERS.map((t) => (
                <TableCell
                  key={t}
                  align="right"
                  data-testid={`farm-need-${c.cell}-${String(t)}`}
                  sx={{ whiteSpace: 'nowrap', color: c.needs[t] === null ? 'success.main' : undefined }}
                >
                  {rangeText(c.needs[t])}
                </TableCell>
              ))}
              <TableCell sx={{ color: 'text.secondary' }}>{sourcesText(c)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Paper>
  )
}

function Targets({ cells }: { cells: FarmCell[] }): JSX.Element {
  const [target, setTarget] = useState<FarmTier>(8)
  const targets = farmTargets(cells, target)
  return (
    <Paper variant="outlined" sx={{ p: 2 }} data-testid="farm-targets">
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="subtitle2">Where to farm for</Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={target}
          onChange={(_, v: FarmTier | null) => {
            if (v !== null) setTarget(v)
          }}
        >
          {FARM_TIERS.map((t) => (
            <ToggleButton key={t} value={t}>
              +{t}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Stack>
      {targets.length === 0 ? (
        <Typography variant="body2" color="success.main">
          Every piece you own is at +{target} or above.
        </Typography>
      ) : (
        targets.map((t) => (
          <Typography key={t.label} variant="body2" sx={{ mb: 0.5 }}>
            <b>{t.label}</b>
            {t.looted > 0 ? ` · looted build pieces ×${String(t.looted)}` : ''}
            {' · '}
            {t.items.map((i) => `${i.item} (${planSlotLabel(i.cell)}) ${rangeText(i.range)}`).join(', ')}
          </Typography>
        ))
      )}
    </Paper>
  )
}

export default function FarmView({ build, payload }: { build: Build; payload: BuildsPayload }): JSX.Element {
  const { sheet } = useCharacterSheet()
  const { lootHistory, itemOverrides } = useProgress()
  const owned = useMemo(() => ownedCopies(sheet?.carry.rows ?? []), [sheet])
  const seen = useMemo(() => lootSeen(lootHistory), [lootHistory])
  const motes = useMemo(() => moteSummary(heldMotes(lootHistory, itemOverrides)), [lootHistory, itemOverrides])
  const cells = useMemo(() => farmCells(build, owned, seen, payload.sources), [build, owned, seen, payload])
  if (sheet === null) {
    return <Typography color="text.secondary">No inventory dump yet: type /outputfile inventory in game.</Typography>
  }
  return (
    <Stack spacing={2} data-testid="farm-view">
      <Summary cells={cells} motes={motes} />
      <CellTable cells={cells} />
      <Targets cells={cells} />
      <Typography variant="caption" color="text.secondary">
        Main pieces only; exaltation donors are not planned here. Inventory: the newest dump. Drop tiers and
        sources: your loot log.
      </Typography>
    </Stack>
  )
}
