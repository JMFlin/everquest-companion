// buildFarm: how many more copies of each build piece you need to farm to reach +7, +8, +9 and
// +10, given the copies you own and the motes you hold. The Builds tab's Farm view draws it.
//
// THE MERGE ARITHMETIC (eqlwiki Gear Merge Experience, the same numbers the mote planner uses):
// reaching +r takes 2^r - 1 XP, and a spare copy at +t merges in for 2^t XP at any tier. Motes add
// little directly - the best gives 10 XP - and each can only be applied while the item is at or
// below its cap. What motes CAN do cheaply is level a spare before it merges: a Mote of Major
// Potential (5 XP, cap +4) takes a copy at +4 or below up to +5, and a +5 copy merges for 32.
//
// So every count here is a RANGE:
//   * high end: each new copy merges as it drops, worth 2^dropTier;
//   * low end:  each copy (held spares too) is first levelled to +5 with motes, worth 32.
// `moteSummary` says how many copies your Major motes can actually level, which is where the real
// number sits between the two. Motes of Greater Potential and up go straight onto pieces; they are
// listed, not subtracted, because they are a few percent of any gap above +6.
//
// THE DROP TIER is what copies of that item have looted at in this character's log (the most
// common tier), because many build pieces drop pre-levelled (+4). Never looted: +0, flagged.
//
// WHICH COPY IS THE PIECE: the best copy worn or kept on the Equipment key ring (where Legends
// stores gear for loadouts; the dump lists it as key-ring category `Equipment`). Bags, bank, shared bank, depot and hoard copies are spares, and so are stored
// copies no cell of this build uses. Exaltation donors are not planned here.

import type { LootEvent } from './types'
import type { Build, ItemSource } from './builds'
import { itemNameKey } from './builds'
import { parseItemName, splitLocationPath } from './outputs/inventory'
import { PLAN_SLOTS, type PlanSlotId } from './planner/types'
import { MOTES, type MoteName } from './planner/moteXp'

export const FARM_TIERS = [7, 8, 9, 10] as const
export type FarmTier = (typeof FARM_TIERS)[number]

/** The tier a Mote of Major Potential (cap +4) can level a spare to before it merges. */
export const BOOST_TIER = 5

/** XP to reach `tier` from +0. */
export function xpTo(tier: number): number {
  return 2 ** tier - 1
}

/** What one copy at `tier` merges in for, levelled to `BOOST_TIER` first when `boosted`. */
export function copyXp(tier: number, boosted: boolean): number {
  return 2 ** (boosted && tier < BOOST_TIER ? BOOST_TIER : tier)
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

/** One place copies of an item were looted from, and how many times. */
export interface LootSource {
  label: string
  count: number
}

/** What the log says about one item: the tiers it dropped at and who dropped it. */
export interface LootSeen {
  /** the most common tier it looted at */
  dropTier: number
  sources: LootSource[]
}

/** The log's loot rows → per `itemNameKey`, the usual drop tier and the mobs it came from. */
export function lootSeen(loot: readonly LootEvent[]): Map<string, LootSeen> {
  const tiers = new Map<string, Map<number, number>>()
  const mobs = new Map<string, Map<string, number>>()
  for (const e of loot) {
    const parsed = parseItemName(e.item)
    const key = itemNameKey(parsed.base)
    const byTier = tiers.get(key) ?? new Map<number, number>()
    byTier.set(parsed.tier ?? 0, (byTier.get(parsed.tier ?? 0) ?? 0) + 1)
    tiers.set(key, byTier)
    if (e.source === undefined) continue
    const label = e.zone === undefined ? e.source : `${e.source} (${e.zone})`
    const byMob = mobs.get(key) ?? new Map<string, number>()
    byMob.set(label, (byMob.get(label) ?? 0) + 1)
    mobs.set(key, byMob)
  }
  const out = new Map<string, LootSeen>()
  for (const [key, byTier] of tiers) {
    const dropTier = [...byTier].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0]
    const sources = [...(mobs.get(key) ?? new Map<string, number>())]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    out.set(key, { dropTier, sources })
  }
  return out
}

/** Copies still to farm for one target tier: `lo` with every copy levelled to +5, `hi` without. */
export interface CopyRange {
  lo: number
  hi: number
}

export interface FarmCell {
  cell: PlanSlotId
  item: string
  /** the piece's tier; null when you own no copy */
  tier: number | null
  /** where the piece is: `Head`, `Equipment`, or a bag when only spares exist */
  place: string | null
  spares: OwnedCopy[]
  dropTier: number
  /** false when the log never showed this item drop, so `dropTier` is the +0 assumption */
  dropSeen: boolean
  /** per target tier; null when the piece is already there */
  needs: Record<FarmTier, CopyRange | null>
  /** looted-from first (with counts), then the item database's droppers */
  sources: LootSource[]
}

function copiesFor(gap: number, spares: readonly OwnedCopy[], dropTier: number, boosted: boolean): number {
  const rest = gap - spares.reduce((n, s) => n + copyXp(s.tier, boosted), 0)
  return rest <= 0 ? 0 : Math.ceil(rest / copyXp(dropTier, boosted))
}

function rangeFor(
  target: FarmTier,
  tier: number | null,
  spares: readonly OwnedCopy[],
  dropTier: number
): CopyRange | null {
  if (tier !== null && tier >= target) return null
  // A missing piece: the first copy you farm becomes it, at its drop tier.
  const from = tier ?? Math.min(dropTier, target)
  const first = tier === null ? 1 : 0
  const gap = xpTo(target) - xpTo(from)
  return {
    lo: first + copiesFor(gap, spares, dropTier, true),
    hi: first + copiesFor(gap, spares, dropTier, false)
  }
}

function corpusSources(source: ItemSource | null | undefined): LootSource[] {
  return (source?.drops ?? []).map((d) => ({
    label: d.zone === undefined ? d.mob : `${d.mob} (${d.zone})`,
    count: 0
  }))
}

/**
 * THE MODEL: one row per cell of the build, in slot order. A cell sharing its item with an
 * earlier cell gets the next-best copy as its piece and no spares (the first cell took them).
 */
export function farmCells(
  build: Build,
  owned: ReadonlyMap<string, readonly OwnedCopy[]>,
  seen: ReadonlyMap<string, LootSeen>,
  sources: Readonly<Record<string, ItemSource | null>>
): FarmCell[] {
  const left = new Map<string, OwnedCopy[]>()
  for (const [key, copies] of owned) left.set(key, [...copies].sort((a, b) => b.tier - a.tier))
  const cells: FarmCell[] = []
  for (const cell of PLAN_SLOTS) {
    const want = build.slots[cell]
    if (want === undefined) continue
    const key = itemNameKey(want.name)
    cells.push(cellOf({ cell, item: want.name }, left.get(key) ?? [], seen.get(key), sources[key]))
  }
  return cells
}

/** One cell: its piece is the best stored copy (else the best copy); the rest of the pool are spares. */
function cellOf(
  { cell, item }: { cell: PlanSlotId; item: string },
  pool: OwnedCopy[],
  log: LootSeen | undefined,
  source: ItemSource | null | undefined
): FarmCell {
  const pieceAt = pool.findIndex((c) => c.stored)
  const piece = pool.length === 0 ? null : pool.splice(pieceAt === -1 ? 0 : pieceAt, 1)[0]
  const spares = pool.splice(0)
  const tier = piece?.tier ?? null
  const dropTier = log?.dropTier ?? 0
  const needs = {} as Record<FarmTier, CopyRange | null>
  for (const t of FARM_TIERS) needs[t] = rangeFor(t, tier, spares, dropTier)
  return {
    cell,
    item,
    tier,
    place: piece?.place ?? null,
    spares,
    dropTier,
    dropSeen: log !== undefined,
    needs,
    sources: log !== undefined && log.sources.length > 0 ? log.sources : corpusSources(source)
  }
}

/** Summed copies per target tier, over every cell not yet there. */
export function farmTotals(cells: readonly FarmCell[]): Record<FarmTier, CopyRange> {
  const out = {} as Record<FarmTier, CopyRange>
  for (const t of FARM_TIERS) {
    out[t] = { lo: 0, hi: 0 }
    for (const c of cells) {
      out[t].lo += c.needs[t]?.lo ?? 0
      out[t].hi += c.needs[t]?.hi ?? 0
    }
  }
  return out
}

/** One mob (or zone line) worth farming at a target tier, and what it gives the build there. */
export interface FarmTarget {
  label: string
  /** times you looted a build piece from it; 0 when only the item database names it */
  looted: number
  items: { item: string; cell: PlanSlotId; range: CopyRange }[]
}

/** Every source of a piece still short of `target`, most-needed copies first. */
export function farmTargets(cells: readonly FarmCell[], target: FarmTier): FarmTarget[] {
  const byLabel = new Map<string, FarmTarget>()
  for (const c of cells) {
    const range = c.needs[target]
    if (range === null) continue
    for (const s of c.sources) {
      const t = byLabel.get(s.label) ?? { label: s.label, looted: 0, items: [] }
      t.looted += s.count
      t.items.push({ item: c.item, cell: c.cell, range })
      byLabel.set(s.label, t)
    }
  }
  const need = (t: FarmTarget): number => t.items.reduce((n, i) => n + i.range.lo, 0)
  return [...byLabel.values()].sort(
    (a, b) => b.looted - a.looted || need(b) - need(a) || a.label.localeCompare(b.label)
  )
}

/** What your motes do for this: how many copies the Majors level to +5, and the XP the rest add. */
export interface MoteSummary {
  majors: number
  /** copies the Majors can level to +5, from +4 and from +0 */
  boostsFrom4: number
  boostsFrom0: number
  /** XP of Greater-and-up motes, which go straight onto pieces at +5 to +9 */
  highXp: number
}

const MAJOR: MoteName = 'Mote of Major Potential'

export function moteSummary(held: Readonly<Partial<Record<MoteName, number>>>): MoteSummary {
  const majors = held[MAJOR] ?? 0
  const majorXp = MOTES.find((m) => m.name === MAJOR)?.itemXp ?? 0
  const perBoost = (from: number): number => Math.ceil((xpTo(BOOST_TIER) - xpTo(from)) / majorXp)
  let highXp = 0
  for (const m of MOTES) if (m.itemCap >= BOOST_TIER) highXp += (held[m.name] ?? 0) * m.itemXp
  return {
    majors,
    boostsFrom4: Math.floor(majors / perBoost(4)),
    boostsFrom0: Math.floor(majors / perBoost(0)),
    highXp
  }
}
