// MotesView — held motes, the currency-window scan, and the upgrade planner. Held counts come from
// heldMotes (the motes overlay uses the same rule); the planner state from usePlanner (also shared
// with the overlay). Runes are scanned and saved for the Sky tracker, but not shown here.

import type { JSX } from 'react'
import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
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
import { MOTES, type MoteName, type SectionPlan } from '@shared/planner/motes'
import { useProgress } from '../posky/useProgress'
import { ScanPreview } from './ScanPreview'
import { GearExtras } from './GearExtras'
import { heldMotes } from './heldMotes'
import { useAutoRescan } from './useAutoRescan'
import { RANKS, inPick, outcomeText, pickLabel, shortMote, stepText, usePlanner, type RankPick } from './usePlanner'

function RankPicker(props: { label: string; pick: RankPick; onPick: (n: number) => void }): JSX.Element {
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <Typography sx={{ width: 64 }}>{props.label}</Typography>
      <ToggleButtonGroup size="small" data-testid={`motes-pick-${props.label.toLowerCase()}`}>
        {RANKS.map((n) => (
          <ToggleButton key={n} value={n} selected={inPick(props.pick, n)} onClick={() => props.onPick(n)}>
            {n}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <Typography variant="body2" color="text.secondary">
        {pickLabel(props.pick)}
      </Typography>
    </Stack>
  )
}

function PlanSteps({ plan }: { plan: SectionPlan }): JSX.Element {
  const outcome = outcomeText(plan)
  return (
    <Box sx={{ pl: 9 }}>
      {plan.steps.map((s, i) => (
        <Typography key={i} variant="body2">
          {stepText(s)}
        </Typography>
      ))}
      <Typography variant="body2" color={outcome.ok ? 'success.main' : 'warning.main'}>
        {outcome.text}
      </Typography>
    </Box>
  )
}

function PlannerPanel({ held }: { held: Record<MoteName, number> }): JSX.Element {
  const p = usePlanner(held)
  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6" sx={{ mb: 1 }}>
        Upgrade planner
      </Typography>
      <Stack spacing={2}>
        <RankPicker label="Spell" pick={p.spell} onPick={p.pickSpell} />
        {p.plan.spell && <PlanSteps plan={p.plan.spell} />}
        <RankPicker label="Gear" pick={p.gear} onPick={p.pickGear} />
        {p.gear.sel && (
          <GearExtras
            from={p.gear.sel.from}
            fraction={p.fraction}
            onFraction={p.setFraction}
            spares={p.spares}
            onSpares={p.setSpares}
          />
        )}
        {p.plan.gear && <PlanSteps plan={p.plan.gear} />}
        {(p.plan.spell ?? p.plan.gear) && (
          <Typography variant="body2" color="text.secondary">
            Left over: {MOTES.map((m) => `${p.plan.remaining[m.name]} ${shortMote(m.name)}`).join(', ')}
          </Typography>
        )}
      </Stack>
    </Paper>
  )
}

export default function MotesView(): JSX.Element {
  const { lootHistory, itemOverrides } = useProgress()
  const held = useMemo(() => heldMotes(lootHistory, itemOverrides), [lootHistory, itemOverrides])
  const scannedAt = itemOverrides.find((o) => o.key === MOTES[0].name.toLowerCase())?.setAt

  useEffect(() => {
    void window.eq.warmCurrencyScan()
  }, [])
  const auto = useAutoRescan(window.eq)
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
          {scanning && (
            <Button size="small" color="warning" onClick={() => void window.eq.cancelCurrencyScan()}>
              Stop
            </Button>
          )}
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={auto.enabled}
                onChange={(e) => auto.setEnabled(e.target.checked)}
                data-testid="motes-auto-rescan"
              />
            }
            label="Auto rescan every 45 s"
          />
          {auto.note && <Typography variant="body2" color="success.main">{auto.note}</Typography>}
        </Stack>
        {scan && <ScanPreview result={scan} onClose={() => setScan(null)} />}
        <Alert severity="info" sx={{ my: 1 }}>
          The log never says which mote went into an upgrade. Rescan after upgrading.
        </Alert>
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
      </Paper>

      <PlannerPanel held={held} />
    </Stack>
  )
}
