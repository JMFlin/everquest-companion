// FarmView: the Builds tab's Farm view. For the selected build, how many more copies of each piece
// to farm to reach +7, +8, +9 and +10, how many Major motes that takes against the ones you hold,
// and where the pieces drop. Every number comes from @shared/buildFarm; this file reads the three
// inputs (the character's inventory dump, the loot log, the held motes) and draws the result.

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
  lootSources,
  moteSummary,
  moteVerdict,
  ownedCopies,
  sourceLabel,
  type FarmCell,
  type FarmTarget,
  type FarmTier,
  type MoteSummary,
  type MoteVerdict,
  type OwnedCopy,
  type PieceNeed,
  type Range
} from '@shared/buildFarm'
import { planSlotLabel, type PlanSlotId } from '@shared/planner/types'
import { useCharacterSheet } from '../character/useCharacterSheet'
import { useProgress } from '../posky/useProgress'
import { heldMotes } from '../motes/heldMotes'

function rangeText(r: Range): string {
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
    .map((s) => (s.count > 0 ? `${sourceLabel(s)} ×${String(s.count)}` : sourceLabel(s)))
  return c.sources.length > 2 ? `${shown.join('; ')} +${String(c.sources.length - 2)}` : shown.join('; ')
}

const VERDICT_TEXT: Record<MoteVerdict, string> = {
  enough: 'your Majors cover it: farm copies',
  maybe: 'Majors may run short, depending on the tiers copies drop at',
  short: 'not enough Majors: farm copies and motes'
}

const VERDICT_COLOR: Record<MoteVerdict, string> = {
  enough: 'success.main',
  maybe: 'warning.main',
  short: 'error.main'
}

function TierTotal({ tier, total, motes }: { tier: FarmTier; total: PieceNeed; motes: MoteSummary }): JSX.Element {
  const verdict = moteVerdict(total, motes.majors)
  return (
    <Box data-testid={`farm-total-${String(tier)}`} sx={{ minWidth: 180 }}>
      <Typography variant="caption" color="text.secondary">
        Every piece to +{tier}
      </Typography>
      <Typography variant="h6">{total.copies} copies</Typography>
      <Typography variant="body2">{rangeText(total.majors)} Majors</Typography>
      {total.copies > 0 || total.majors.hi > 0 ? (
        <Typography variant="body2" sx={{ color: VERDICT_COLOR[verdict] }}>
          {VERDICT_TEXT[verdict]}
        </Typography>
      ) : null}
    </Box>
  )
}

function Summary({ cells, motes }: { cells: FarmCell[]; motes: MoteSummary }): JSX.Element {
  const totals = farmTotals(cells)
  return (
    <Paper variant="outlined" sx={{ p: 2 }} data-testid="farm-summary">
      <Stack direction="row" spacing={4} sx={{ mb: 1 }}>
        {FARM_TIERS.map((t) => (
          <TierTotal key={t} tier={t} total={totals[t]} motes={motes} />
        ))}
      </Stack>
      <Typography variant="body2" color="text.secondary">
        Every copy drops at +0 to +4. Levelled to +{BOOST_TIER} with Major motes it merges for 32 XP, so the
        copy count is exact and the Majors are a range: 4 per copy that drops at +4, 7 per copy at +0. You
        hold {motes.majors} Majors. Greater-and-up motes ({motes.highXp} XP) go straight onto pieces and are
        not counted.
      </Typography>
    </Paper>
  )
}

function NeedCell({ c, tier }: { c: FarmCell; tier: FarmTier }): JSX.Element {
  const need = c.needs[tier]
  return (
    <TableCell
      align="right"
      data-testid={`farm-need-${c.cell}-${String(tier)}`}
      title={need === null ? 'Already there' : `${rangeText(need.majors)} Majors`}
      sx={{ whiteSpace: 'nowrap', color: need === null ? 'success.main' : undefined }}
    >
      {need === null ? '✓' : need.copies}
    </TableCell>
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
            {FARM_TIERS.map((t) => (
              <TableCell key={t} align="right" title="Copies to farm; hover a number for the Majors it takes">
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
              {FARM_TIERS.map((t) => (
                <NeedCell key={t} c={c} tier={t} />
              ))}
              <TableCell sx={{ color: 'text.secondary' }}>{sourcesText(c)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Paper>
  )
}

/** One row per piece in a zone, its mobs in the zone's order (looted-from first). */
function itemRows(targets: readonly FarmTarget[]): { cell: PlanSlotId; item: string; mobs: string[] }[] {
  const rows = new Map<PlanSlotId, { cell: PlanSlotId; item: string; mobs: string[] }>()
  for (const t of targets) {
    for (const i of t.items) {
      const r = rows.get(i.cell) ?? { cell: i.cell, item: i.item, mobs: [] }
      r.mobs.push(t.mob)
      rows.set(i.cell, r)
    }
  }
  return [...rows.values()]
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
          Nothing to farm for +{target}.
        </Typography>
      ) : (
        targets.map((z) => (
          <Box key={z.zone} sx={{ mb: 1 }} data-testid="farm-zone">
            <Typography variant="overline" color="text.secondary" sx={{ display: 'block', lineHeight: 2 }}>
              {z.zone}
            </Typography>
            {itemRows(z.targets).map((r) => (
              <Typography key={r.cell} variant="body2" sx={{ mb: 0.5, pl: 1 }}>
                <b>{r.item}</b> - {r.mobs.join(', ')}
              </Typography>
            ))}
          </Box>
        ))
      )}
    </Paper>
  )
}

export default function FarmView({ build, payload }: { build: Build; payload: BuildsPayload }): JSX.Element {
  const { sheet } = useCharacterSheet()
  const { lootHistory, itemOverrides } = useProgress()
  const owned = useMemo(() => ownedCopies(sheet?.carry.rows ?? []), [sheet])
  const looted = useMemo(() => lootSources(lootHistory), [lootHistory])
  const motes = useMemo(() => moteSummary(heldMotes(lootHistory, itemOverrides)), [lootHistory, itemOverrides])
  const cells = useMemo(() => farmCells(build, owned, looted, payload.sources), [build, owned, looted, payload])
  if (sheet === null) {
    return <Typography color="text.secondary">No inventory dump yet: type /outputfile inventory in game.</Typography>
  }
  return (
    <Stack spacing={2} data-testid="farm-view">
      <Summary cells={cells} motes={motes} />
      <CellTable cells={cells} />
      <Targets cells={cells} />
      <Typography variant="caption" color="text.secondary">
        Main pieces only; exaltation donors are not planned here. Inventory: the newest dump. Sources: your
        loot log, then the item database.
      </Typography>
    </Stack>
  )
}
