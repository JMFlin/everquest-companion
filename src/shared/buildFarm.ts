// buildFarm: how many more copies of each build piece you need to farm to reach +7, +8, +9 and
// +10, and how many Major motes that takes, given the copies you own and the motes you hold. The
// Builds tab's Farm view draws it.
//
// THE MERGE ARITHMETIC (eqlwiki Gear Merge Experience, the same numbers the mote planner uses):
// reaching +r takes 2^r - 1 XP, and a copy at +t merges in for 2^t XP at any tier. Motes add little
// directly (the best gives 10 XP) and only while the item is at or below the mote's cap. What a Mote
// of Major Potential (5 XP, cap +4) does cheaply is level a copy to +5 before it merges, and a +5
// copy merges for 32.
//
// Any copy drops at +0 to +4 (owner's game knowledge), so every copy is planned the same way: level
// it to +5 with Majors, merge it for 32. That makes the COPY count exact for a target, and moves the
// uncertainty into the MAJOR count: 4 for a copy that dropped at +4 (16 XP), 7 for one at +0 (31 XP).
// Comparing that range with the Majors you hold is the answer to "farm copies, motes, or both".
//
// A piece below +5 takes Majors directly up to +5 first. A missing piece is one more copy, at an
// unknown +0 to +4. Spares already held are used before new copies, best first; a spare at +5 or
// above merges as it is. Motes of Greater Potential and up go straight onto pieces at +5 to +9; they
// are listed, not subtracted, because they are a few percent of any gap above +6. The lower motes
// are not counted either.
//
// WHICH COPY IS THE PIECE: the best copy worn or kept on the Equipment key ring (where Legends
// stores gear for loadouts; the dump lists it as key-ring category `Equipment`). Bags, bank, shared
// bank, depot and hoard copies are spares, and so are stored copies no cell of this build uses.
// Exaltation donors are not planned here.

import type { LootEvent } from './types'
import type { Build, ItemSource } from './builds'
import { itemNameKey } from './builds'
import { parseItemName, splitLocationPath } from './outputs/inventory'
import { PLAN_SLOTS, type PlanSlotId } from './planner/types'
import { MOTES, type MoteName } from './planner/moteXp'
import { zonePlace } from './zones'

export const FARM_TIERS = [7, 8, 9, 10] as const
export type FarmTier = (typeof FARM_TIERS)[number]

/** The tier a Mote of Major Potential (cap +4) levels a copy to before it merges. */
export const BOOST_TIER = 5

/** Highest tier a copy drops at. */
export const MAX_DROP_TIER = 4

const MAJOR: MoteName = 'Mote of Major Potential'
const MAJOR_XP = 5

/** XP to reach `tier` from +0. */
export function xpTo(tier: number): number {
  return 2 ** tier - 1
}

/** Majors that take an item at `tier` to `BOOST_TIER`; 0 at or above it. */
export function majorsToBoost(tier: number): number {
  return tier >= BOOST_TIER ? 0 : Math.ceil((xpTo(BOOST_TIER) - xpTo(tier)) / MAJOR_XP)
}

/** What a copy at `tier` merges in for once levelled to `BOOST_TIER` (or as it is, above it). */
function boostedXp(tier: number): number {
  return 2 ** Math.max(tier, BOOST_TIER)
}

/** One copy of an item in the dump. */
export interface OwnedCopy {
  tier: number
  /** `Bank7`, `General 6`, `Hoard 134`, `Equipment`, `Head` */
  place: string
  /** worn, or kept on the Equipment key ring: a piece, not a spare */
  stored: boolean
}

/** An inventory row as the character sheet hands it over (`CarryRow`, structurally). */
export interface DumpRow {
  name: string
  location: string
  lane: string
}

/** The key-ring category gear is kept under (`carryAll` writes a key-ring row's location as `<section> / <category>`). */
const EQUIPMENT_CATEGORY = '/ Equipment'

/** One dump row as a copy, or null for a socket, an exaltation, another key ring or another section. */
function copyOf(row: DumpRow): { key: string; copy: OwnedCopy } | null {
  const { base, path } = splitLocationPath(row.location)
  const worn = row.lane === 'worn'
  const equipment = row.lane === 'keyring' && row.location.endsWith(EQUIPMENT_CATEGORY)
  if (worn && path.length > 0) return null
  if ((row.lane === 'keyring' && !equipment) || row.lane.startsWith('section:')) return null
  const parsed = parseItemName(row.name)
  if (parsed.exaltation) return null
  return {
    key: itemNameKey(parsed.base),
    copy: { tier: parsed.tier ?? 0, place: equipment ? 'Equipment' : base, stored: worn || equipment }
  }
}

/** Every copy the dump holds, keyed by `itemNameKey`. */
export function ownedCopies(rows: readonly DumpRow[]): Map<string, OwnedCopy[]> {
  const out = new Map<string, OwnedCopy[]>()
  for (const row of rows) {
    const found = copyOf(row)
    if (found !== null) out.set(found.key, [...(out.get(found.key) ?? []), found.copy])
  }
  return out
}

/** One place copies of an item were looted from, and how many times (0 = item database only). */
export interface LootSource {
  mob: string
  /** the place, instance and tier stripped (`zonePlace`); null when nothing names it */
  zone: string | null
  count: number
}

export function sourceLabel(s: LootSource): string {
  return s.zone === null ? s.mob : `${s.mob} (${s.zone})`
}

const sourceId = (mob: string, zone: string | null): string => `${mob}\u0000${zone ?? ''}`

/** The log's loot rows → per `itemNameKey`, the mobs it was looted from, most first. */
export function lootSources(loot: readonly LootEvent[]): Map<string, LootSource[]> {
  const mobs = new Map<string, Map<string, LootSource>>()
  for (const e of loot) {
    if (e.source === undefined) continue
    const key = itemNameKey(parseItemName(e.item).base)
    const zone = e.zone === undefined ? null : zonePlace(e.zone)
    const byMob = mobs.get(key) ?? new Map<string, LootSource>()
    const id = sourceId(e.source, zone)
    const s = byMob.get(id) ?? { mob: e.source, zone, count: 0 }
    s.count += 1
    byMob.set(id, s)
    mobs.set(key, byMob)
  }
  const out = new Map<string, LootSource[]>()
  for (const [key, byMob] of mobs) {
    out.set(
      key,
      [...byMob.values()].sort((a, b) => b.count - a.count || sourceLabel(a).localeCompare(sourceLabel(b)))
    )
  }
  return out
}

/** A low–high pair: Majors needed when every new copy drops at +4 (lo) or at +0 (hi). */
export interface Range {
  lo: number
  hi: number
}

/** What reaching one target tier takes for one piece. */
export interface PieceNeed {
  /** new copies to farm, a missing piece's first copy included */
  copies: number
  majors: Range
}

export interface FarmCell {
  cell: PlanSlotId
  item: string
  /** the piece's tier; null when you own no copy */
  tier: number | null
  /** where the piece is: `Head`, `Equipment`, or a bag when only spares exist */
  place: string | null
  spares: OwnedCopy[]
  /** per target tier; null when the piece is already there */
  needs: Record<FarmTier, PieceNeed | null>
  /** looted-from first (with counts), then the item database's droppers */
  sources: readonly LootSource[]
}

const NEW_COPY: Range = { lo: majorsToBoost(MAX_DROP_TIER), hi: majorsToBoost(0) }

function needFor(target: FarmTier, tier: number | null, spares: readonly OwnedCopy[]): PieceNeed | null {
  if (tier !== null && tier >= target) return null
  // The piece itself first: up to +5 with Majors. A missing piece is a new copy at +0 to +4.
  const majors = tier === null ? { ...NEW_COPY } : { lo: majorsToBoost(tier), hi: majorsToBoost(tier) }
  let rest = xpTo(target) - xpTo(Math.max(tier ?? 0, BOOST_TIER))
  for (const s of [...spares].sort((a, b) => b.tier - a.tier)) {
    if (rest <= 0) break
    rest -= boostedXp(s.tier)
    majors.lo += majorsToBoost(s.tier)
    majors.hi += majorsToBoost(s.tier)
  }
  const fresh = rest <= 0 ? 0 : Math.ceil(rest / boostedXp(0))
  return {
    copies: fresh + (tier === null ? 1 : 0),
    majors: { lo: majors.lo + fresh * NEW_COPY.lo, hi: majors.hi + fresh * NEW_COPY.hi }
  }
}

function corpusSources(source: ItemSource | null | undefined): LootSource[] {
  return (source?.drops ?? []).map((d) => ({
    mob: d.mob,
    zone: d.zone === undefined ? null : zonePlace(d.zone),
    count: 0
  }))
}

/** One cell: its piece is the best stored copy (else the best copy); the rest of the pool are spares. */
function cellOf(
  { cell, item }: { cell: PlanSlotId; item: string },
  pool: OwnedCopy[],
  looted: readonly LootSource[] | undefined,
  source: ItemSource | null | undefined
): FarmCell {
  const pieceAt = pool.findIndex((c) => c.stored)
  const piece = pool.length === 0 ? null : pool.splice(pieceAt === -1 ? 0 : pieceAt, 1)[0]
  const spares = pool.splice(0)
  const tier = piece?.tier ?? null
  const needs = {} as Record<FarmTier, PieceNeed | null>
  for (const t of FARM_TIERS) needs[t] = needFor(t, tier, spares)
  return {
    cell,
    item,
    tier,
    place: piece?.place ?? null,
    spares,
    needs,
    sources: looted !== undefined && looted.length > 0 ? looted : corpusSources(source)
  }
}

/**
 * THE MODEL: one row per cell of the build, in slot order. A cell sharing its item with an
 * earlier cell gets the next-best copy as its piece and no spares (the first cell took them).
 */
export function farmCells(
  build: Build,
  owned: ReadonlyMap<string, readonly OwnedCopy[]>,
  looted: ReadonlyMap<string, readonly LootSource[]>,
  sources: Readonly<Record<string, ItemSource | null>>
): FarmCell[] {
  const left = new Map<string, OwnedCopy[]>()
  for (const [key, copies] of owned) left.set(key, [...copies].sort((a, b) => b.tier - a.tier))
  const cells: FarmCell[] = []
  for (const cell of PLAN_SLOTS) {
    const want = build.slots[cell]
    if (want === undefined) continue
    const key = itemNameKey(want.name)
    cells.push(cellOf({ cell, item: want.name }, left.get(key) ?? [], looted.get(key), sources[key]))
  }
  return cells
}

/** Copies and Majors over every cell not yet at the target. */
export function farmTotals(cells: readonly FarmCell[]): Record<FarmTier, PieceNeed> {
  const out = {} as Record<FarmTier, PieceNeed>
  for (const t of FARM_TIERS) {
    out[t] = { copies: 0, majors: { lo: 0, hi: 0 } }
    for (const c of cells) {
      out[t].copies += c.needs[t]?.copies ?? 0
      out[t].majors.lo += c.needs[t]?.majors.lo ?? 0
      out[t].majors.hi += c.needs[t]?.majors.hi ?? 0
    }
  }
  return out
}

/** Farm copies only, or motes too: what the Majors you hold say about one target's total. */
export type MoteVerdict = 'enough' | 'maybe' | 'short'

export function moteVerdict(total: PieceNeed, majorsHeld: number): MoteVerdict {
  if (total.majors.hi <= majorsHeld) return 'enough'
  return total.majors.lo <= majorsHeld ? 'maybe' : 'short'
}

/** One mob worth farming at a target tier, and what it gives the build there. */
export interface FarmTarget {
  mob: string
  /** times you looted a build piece from it; 0 when only the item database names it */
  looted: number
  items: { item: string; cell: PlanSlotId; copies: number }[]
}

/** One zone's mobs worth farming; `zone` null collects the mobs nothing places. */
export interface FarmZone {
  zone: string | null
  looted: number
  targets: FarmTarget[]
}

const copiesOf = (t: FarmTarget): number => t.items.reduce((n, i) => n + i.copies, 0)

function byYield<T extends { looted: number }>(copies: (x: T) => number, name: (x: T) => string) {
  return (a: T, b: T): number => b.looted - a.looted || copies(b) - copies(a) || name(a).localeCompare(name(b))
}

/**
 * Every source of a piece short of `target`, grouped by zone: zones and mobs you have looted
 * build pieces from first, then by copies they can give. Placeless mobs come last.
 */
export function farmTargets(cells: readonly FarmCell[], target: FarmTier): FarmZone[] {
  const zones = new Map<string | null, Map<string, FarmTarget>>()
  for (const c of cells) {
    const need = c.needs[target]
    if (need === null || need.copies === 0) continue
    for (const s of c.sources) {
      const mobs = zones.get(s.zone) ?? new Map<string, FarmTarget>()
      const t = mobs.get(s.mob) ?? { mob: s.mob, looted: 0, items: [] }
      t.looted += s.count
      t.items.push({ item: c.item, cell: c.cell, copies: need.copies })
      mobs.set(s.mob, t)
      zones.set(s.zone, mobs)
    }
  }
  const groups = [...zones].map(([zone, mobs]) => {
    const targets = [...mobs.values()].sort(byYield(copiesOf, (t) => t.mob))
    return { zone, looted: targets.reduce((n, t) => n + t.looted, 0), targets }
  })
  // A piece several mobs in the zone drop counts once.
  const zoneCopies = (g: FarmZone): number => {
    const pieces = new Map(g.targets.flatMap((t) => t.items.map((i) => [i.cell, i.copies] as const)))
    return [...pieces.values()].reduce((n, c) => n + c, 0)
  }
  const placed = groups.filter((g) => g.zone !== null).sort(byYield(zoneCopies, (g) => g.zone ?? ''))
  return [...placed, ...groups.filter((g) => g.zone === null)]
}

/** The motes this plan uses: Majors held, and the XP of Greater-and-up motes (not counted in it). */
export interface MoteSummary {
  majors: number
  highXp: number
}

export function moteSummary(held: Readonly<Partial<Record<MoteName, number>>>): MoteSummary {
  let highXp = 0
  for (const m of MOTES) if (m.itemCap >= BOOST_TIER) highXp += (held[m.name] ?? 0) * m.itemXp
  return { majors: held[MAJOR] ?? 0, highXp }
}
