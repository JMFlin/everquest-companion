// BuildsView — pick a saved build, see it cell by cell beside what you wear, and where each piece
// comes from. A cell whose item differs from yours is yellow, and so is an exaltation the build
// names that your socket does not hold. The second dropdown picks which saved dump the build is
// compared against: by default the build's own class loadout. Everything decided about the comparison lives in
// @shared/builds; this file only draws it.

import type { JSX } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import {
  differingCells,
  itemNameKey,
  sourceLines,
  type Build,
  type BuildsPayload,
  type CompareRow,
  type ItemSource,
  type WornDump
} from '@shared/builds'
import { planSlotLabel } from '@shared/planner/types'
import type { View } from '../../appViews'
import { useBuilds, type BuildsBridge, type BuildsState } from './useBuilds'

const BRIDGE: BuildsBridge = {
  getBuilds: () => window.eq.getBuilds(),
  subscribe: (reload) => window.eq.onInventoryReload(() => reload())
}

const IMPORT_HINT = 'npx tsx scripts/import-build.mts https://www.loadoutlegends.com/characters/<name-server>'

function Sources({ source }: { source: ItemSource | null | undefined }): JSX.Element {
  const lines = sourceLines(source ?? null)
  if (lines.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        source unknown
      </Typography>
    )
  }
  return (
    <Box>
      {lines.map((l) => (
        <Typography key={l} variant="body2">
          {l}
        </Typography>
      ))}
    </Box>
  )
}

function Row({ row, source }: { row: CompareRow; source: ItemSource | null | undefined }): JSX.Element {
  return (
    <TableRow
      data-testid={`build-row-${row.cell}`}
      data-differs={row.differs}
      sx={row.differs ? { bgcolor: (t) => alpha(t.palette.warning.main, 0.16) } : undefined}
    >
      <TableCell sx={{ whiteSpace: 'nowrap' }}>{planSlotLabel(row.cell)}</TableCell>
      <TableCell>
        <Typography variant="body2" fontWeight={600}>
          {row.build.name}
        </Typography>
        <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: 'wrap', gap: 0.5 }}>
          {row.exaltations.map((e) => (
            <Chip
              key={e.kind}
              size="small"
              variant="outlined"
              color={e.differs ? 'warning' : 'default'}
              label={`${e.kind}: ${e.build}`}
              title={e.differs ? `Your socket: ${e.worn ?? 'empty'}` : 'Matches your socket'}
            />
          ))}
        </Stack>
      </TableCell>
      <TableCell>
        {row.worn === null ? (
          <Typography variant="body2" color="text.secondary">
            nothing
          </Typography>
        ) : (
          <Typography variant="body2">
            {row.worn.name}
            {row.worn.tier !== undefined ? ` +${row.worn.tier}` : ''}
          </Typography>
        )}
      </TableCell>
      <TableCell>
        <Sources source={source} />
      </TableCell>
    </TableRow>
  )
}

function dumpLabel(dump: WornDump): string {
  return `${dump.classes ?? 'loadout unknown'}, dumped ${new Date(dump.loadedAt).toLocaleString()}`
}

function autoLabel(build: Build | null): string {
  return build?.classes === undefined ? 'Auto: newest dump' : `Auto: this build's loadout (${build.classes})`
}

/** Which dump to compare against: auto, the newest, or any saved loadout. */
function CompareWith({ state }: { state: BuildsState }): JSX.Element {
  const { payload, selected, target, setTarget } = state
  const loadouts = Object.values(payload?.loadouts ?? {})
  return (
    <FormControl size="small" sx={{ minWidth: 300 }}>
      <InputLabel id="build-compare-label">Compare with</InputLabel>
      <Select
        labelId="build-compare-label"
        label="Compare with"
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        data-testid="build-compare"
      >
        <MenuItem value="auto">{autoLabel(selected)}</MenuItem>
        <MenuItem value="newest">Newest dump{payload?.worn ? ` (${dumpLabel(payload.worn)})` : ''}</MenuItem>
        {loadouts.map((d) => (
          <MenuItem key={d.classes} value={d.classes}>
            {dumpLabel(d)}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  )
}

function Picker({ state }: { state: BuildsState }): JSX.Element {
  const { payload, selected, select, reload, rows } = state
  const builds = payload?.builds ?? []
  const differing = rows === null ? 0 : differingCells(rows)
  return (
    <Stack direction="row" spacing={2} alignItems="center">
      <FormControl size="small" sx={{ minWidth: 280 }} disabled={builds.length === 0}>
        <InputLabel id="build-select-label">Build</InputLabel>
        <Select
          labelId="build-select-label"
          label="Build"
          value={selected?.id ?? ''}
          onChange={(e) => select(e.target.value)}
          data-testid="build-select"
        >
          {builds.map((b) => (
            <MenuItem key={b.id} value={b.id}>
              {b.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <CompareWith state={state} />
      <Button variant="outlined" size="small" onClick={reload} data-testid="builds-reload">
        Reload
      </Button>
      {rows !== null && (
        <Typography
          variant="body2"
          color={differing > 0 ? 'warning.main' : 'success.main'}
          data-testid="builds-summary"
        >
          {differing === 0 ? 'You are wearing this build.' : `${differing} of ${rows.length} cells differ`}
        </Typography>
      )}
    </Stack>
  )
}

function missingDump(state: BuildsState): string {
  const key = state.target === 'auto' ? state.selected?.classes : state.target === 'newest' ? undefined : state.target
  return key === undefined
    ? 'No inventory dump for this character yet: type /outputfile inventory in game.'
    : `No saved dump for ${key} yet: in that loadout type /who, then /outputfile inventory.`
}

function Notices({ state, payload }: { state: BuildsState; payload: BuildsPayload }): JSX.Element {
  return (
    <>
      {payload.errors.map((e) => (
        <Alert key={e.file} severity="error">
          {e.file}: {e.message}
        </Alert>
      ))}
      {payload.builds.length === 0 && (
        <Alert severity="info">
          No builds yet. Import one with <code>{IMPORT_HINT}</code>, or put a build file in {payload.dir}.
        </Alert>
      )}
      {state.worn === null && payload.builds.length > 0 && (
        <Alert severity="info" data-testid="builds-missing-dump">
          {missingDump(state)}
        </Alert>
      )}
    </>
  )
}

function CompareTable({ rows, payload }: { rows: CompareRow[]; payload: BuildsPayload }): JSX.Element {
  return (
    <Paper variant="outlined">
      <Table size="small" data-testid="build-table">
        <TableHead>
          <TableRow>
            <TableCell>Slot</TableCell>
            <TableCell>Build</TableCell>
            <TableCell>You wear</TableCell>
            <TableCell>Where it comes from</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => (
            <Row key={r.cell} row={r} source={payload.sources[itemNameKey(r.build.name)]} />
          ))}
        </TableBody>
      </Table>
    </Paper>
  )
}

function BuildsView(): JSX.Element {
  const state = useBuilds(BRIDGE)
  const { payload, selected, rows } = state
  if (payload === null) return <Typography sx={{ p: 2 }}>Loading builds…</Typography>
  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Picker state={state} />
      <Notices state={state} payload={payload} />
      {rows !== null && <CompareTable rows={rows} payload={payload} />}
      <Typography variant="caption" color="text.secondary">
        {state.worn !== null ? `Comparing with ${dumpLabel(state.worn)} · ` : ''}Build files: {payload.dir}
        {selected?.url !== undefined ? ` · imported from ${selected.url}` : ''}
      </Typography>
    </Stack>
  )
}

/** The tab, mounted only on its own view (App.tsx's PlainView delegates the check here). */
export function BuildsTab({ view, viewKey }: { view: View; viewKey: string }): JSX.Element | null {
  return view === 'builds' ? <BuildsView key={viewKey} /> : null
}
