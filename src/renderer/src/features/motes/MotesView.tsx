// MotesView — held motes and Wind Runes, the currency-window scan, and the mote planner.
// Held counts are reconcile's (a confirmed scan is a hand statement per item; loot after it
// still counts forward). The planner is pure: two from→to picks over one shared pool.

import type { JSX } from 'react'
import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography
} from '@mui/material'
import type { CurrencyScanResult } from '@shared/currencyScan'
import { MOTES, planMotes } from '@shared/planner/motes'
import type { MoteName, SectionPlan, Selection } from '@shared/planner/motes'
import { useProgress } from '../posky/useProgress'
import type { InventoryRow } from '../inventory/reconcile'
import { ScanPreview } from './ScanPreview'

const RANKS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

/** First click picks the current rank, the second the goal; a click at or below `from` restarts. */
function nextSelection(sel: Selection | undefined, pending: number | null, n: number) {
  if (pending !== null && n > pending) return { sel: { from: pending, to: n }, pending: null }
  if (n === 10) return { sel, pending: null }
  return { sel: undefined, pending: n }
}

function RankPicker(props: {
  label: string
  sel: Selection | undefined
  pending: number | null
  onPick: (n: number) => void
}): JSX.Element {
  const { sel, pending } = props
  const inRange = (n: number): boolean =>
    sel ? n >= sel.from && n <= sel.to : pending !== null && n === pending
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <Typography sx={{ width: 64 }}>{props.label}</Typography>
      <ToggleButtonGroup size="small" data-testid={`motes-pick-${props.label.toLowerCase()}`}>
        {RANKS.map((n) => (
          <ToggleButton key={n} value={n} selected={inRange(n)} onClick={() => props.onPick(n)}>
            {n}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <Typography variant="body2" color="text.secondary">
        {sel ? `${sel.from} → ${sel.to}` : pending !== null ? `from ${pending}, pick goal` : 'pick current rank'}
      </Typography>
    </Stack>
  )
}

function shortMote(name: MoteName): string {
  return name.replace(/^Mote of /, '').replace(/ Potential$/, '')
}

function PlanSteps({ plan }: { plan: SectionPlan }): JSX.Element {
  return (
    <Box sx={{ pl: 9 }}>
      {plan.steps.map((s, i) =>
        s.kind === 'condense' ? (
          <Typography key={i} variant="body2">
            Condense {s.pairs * 2}× {shortMote(s.mote)} → {s.pairs}× {shortMote(s.into)}
          </Typography>
        ) : (
          <Typography key={i} variant="body2">
            Apply {s.count}× {shortMote(s.mote)} → rank {s.after.full}
            {s.after.full < 10 ? ` (${s.after.fraction}/${2 ** s.after.full})` : ''}
          </Typography>
        )
      )}
      {plan.shortfallXp > 0 ? (
        <Typography variant="body2" color="warning.main">
          Not enough motes: stops at rank {plan.reached.full} ({plan.reached.fraction}/
          {2 ** plan.reached.full}), {plan.shortfallXp} XP short.
        </Typography>
      ) : (
        <Typography variant="body2" color="success.main">
          Reaches {plan.to}
          {plan.overshootXp > 0 ? `, ${plan.overshootXp} XP carries past it` : ', nothing wasted'}.
        </Typography>
      )}
    </Box>
  )
}

function PlannerPanel({ held }: { held: Partial<Record<MoteName, number>> }): JSX.Element {
  const [spell, setSpell] = useState<{ sel?: Selection; pending: number | null }>({ pending: null })
  const [gear, setGear] = useState<{ sel?: Selection; pending: number | null }>({ pending: null })
  const plan = useMemo(() => planMotes(held, { spell: spell.sel, gear: gear.sel }), [held, spell, gear])
  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6" sx={{ mb: 1 }}>
        Upgrade planner
      </Typography>
      <Stack spacing={2}>
        <RankPicker
          label="Spell"
          sel={spell.sel}
          pending={spell.pending}
          onPick={(n) => setSpell(nextSelection(spell.sel, spell.pending, n))}
        />
        {plan.spell && <PlanSteps plan={plan.spell} />}
        <RankPicker
          label="Gear"
          sel={gear.sel}
          pending={gear.pending}
          onPick={(n) => setGear(nextSelection(gear.sel, gear.pending, n))}
        />
        {plan.gear && <PlanSteps plan={plan.gear} />}
        {(plan.spell ?? plan.gear) && (
          <Typography variant="body2" color="text.secondary">
            Left over:{' '}
            {MOTES.map((m) => `${plan.remaining[m.name]} ${shortMote(m.name)}`).join(', ')}
          </Typography>
        )}
      </Stack>
    </Paper>
  )
}

export default function MotesView(): JSX.Element {
  const { inventoryRows } = useProgress()
  const rowsByKey = useMemo(() => {
    const m = new Map<string, InventoryRow>()
    for (const r of inventoryRows) m.set(r.key, r)
    return m
  }, [inventoryRows])
  const held = useMemo(() => {
    const h: Partial<Record<MoteName, number>> = {}
    for (const m of MOTES) h[m.name] = rowsByKey.get(m.name.toLowerCase())?.net ?? 0
    return h
  }, [rowsByKey])
  const runes = useMemo(
    // Real rune names only: the log also yields junk keys like "wind rune jaka from reward chest".
    () => inventoryRows.filter((r) => /^wind rune [a-z]+$/.test(r.key)),
    [inventoryRows]
  )
  const scannedAt = rowsByKey.get(MOTES[0].name.toLowerCase())?.override?.setAt

  useEffect(() => {
    void window.eq.warmCurrencyScan()
  }, [])
  const [scan, setScan] = useState<CurrencyScanResult | null>(null)
  const [scanning, setScanning] = useState(false)
  const runScan = async (): Promise<void> => {
    setScanning(true)
    try {
      setScan(await window.eq.scanCurrency())
    } finally {
      setScanning(false)
    }
  }

  return (
    <Stack spacing={2} sx={{ p: 2 }} data-testid="motes-view">
      <Paper sx={{ p: 2 }}>
        <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="h6">Held</Typography>
          {scannedAt !== undefined && (
            <Chip size="small" label={`scanned ${new Date(scannedAt).toLocaleString()}, loot counted since`} />
          )}
          <Button variant="contained" size="small" disabled={scanning} onClick={() => void runScan()}>
            {scanning ? 'Scanning…' : 'Scan currency window'}
          </Button>
        </Stack>
        {scan && (
          <ScanPreview
            result={scan}
            onConfirm={(counts) => void window.eq.applyCurrencyScan(counts).then(() => setScan(null))}
            onCancel={() => setScan(null)}
          />
        )}
        <Alert severity="info" sx={{ my: 1 }}>
          The log never says which mote went into an upgrade. Rescan after upgrading.
        </Alert>
        <Stack direction="row" spacing={4}>
          <Table size="small" sx={{ width: 'auto' }}>
            <TableBody>
              {MOTES.map((m) => (
                <TableRow key={m.name}>
                  <TableCell>{shortMote(m.name)}</TableCell>
                  <TableCell align="right">{held[m.name]}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Table size="small" sx={{ width: 'auto' }}>
            <TableBody>
              {runes.map((r) => (
                <TableRow key={r.key}>
                  <TableCell>{r.name}</TableCell>
                  <TableCell align="right">{r.net}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Stack>
      </Paper>

      <PlannerPanel held={held} />
    </Stack>
  )
}
