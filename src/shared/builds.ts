// builds.ts — GEAR BUILDS: a saved loadout, what you are wearing, and where the two differ.
//
// A build is a JSON file in `<userData>/builds/` (one file per build, the file stem is its id),
// written by hand, by an agent on request, or by `scripts/import-build.mts` from a
// loadoutlegends.com character page. Main reads the folder; this module owns everything that is
// pure about it: the file format and its one validator, the worn cells read off the dump, and the
// cell-by-cell comparison the Builds tab and overlay draw.
//
// CELLS ARE THE PLANNER'S. A build is keyed by `PlanSlotId` (the twenty-three `PLAN_SLOTS`), and
// what you wear comes from `equippedEntries`, the same cell assignment the planner uses — so the
// second ring is FINGER2 on both sides of the comparison by construction, not by agreement.
//
// THE DIFF IS ABOUT THE ITEM, NOT ITS +N (owner ruling): a cell is different when the base names
// differ, case-insensitively. Merge tier is never compared, and a build file carries none.
//
// EXALTATIONS ARE COMPARED BY SOCKET KIND. The dump files a socketed exaltation under the donor
// item's name in a numbered child slot, and the numbering is measured (inventorySlots.ts,
// FOCUS_SOCKET_INDEX): 7 focus, 8 click, 9 worn, 10 proc. A build names the donor per kind. Only
// the kinds the build names are compared — a build that says nothing about a socket has no opinion
// about it.
//
// SOURCES ARE NOT STORED HERE. Where an item drops is the committed item corpus's fact; main
// resolves it per read (`BuildsPayload.sources`), so a corpus correction reaches every build.
//
// PURE: no fs, no Electron (tests/builds.test.mts drives it under the node runner).

import { parseItemName, type InventoryDump } from './outputs/inventory'
import { equippedEntries } from './planner/inventorySlots'
import { PLAN_SLOTS, type PlanSlotId } from './planner/types'

export type ExaltKind = 'focus' | 'click' | 'worn' | 'proc'

export const EXALT_KINDS: readonly ExaltKind[] = ['focus', 'click', 'worn', 'proc']

/** Dump child slot index → socket kind (measured; see the header). */
const SOCKET_KIND: Readonly<Record<number, ExaltKind>> = { 7: 'focus', 8: 'click', 9: 'worn', 10: 'proc' }

export type Exaltations = Partial<Record<ExaltKind, string>>

/** One cell of a build: the item, and optionally the donor socketed per kind. Base names only. */
export interface BuildItem {
  name: string
  exaltations?: Exaltations
}

export interface Build {
  /** the file stem — stable, and what the tab's selection remembers */
  id: string
  name: string
  /** where the build was imported from, when it was */
  url?: string
  slots: Partial<Record<PlanSlotId, BuildItem>>
}

/** What one cell of the body holds, read off the dump. */
export interface WornItem {
  name: string
  tier?: number
  exaltations: Exaltations
}

export type WornCells = Partial<Record<PlanSlotId, WornItem>>

/** Where an item comes from, per the committed corpus. `null` in the payload = the corpus has no row. */
export interface ItemSource {
  drops: { mob: string; zone?: string }[]
  quests: string[]
}

/** The `builds:get` answer: every readable build, every unreadable file, and what you wear. */
export interface BuildsPayload {
  /** the folder main read — the tab shows it so a user knows where to drop a file */
  dir: string
  builds: Build[]
  /** a file that failed validation, with why — shown, never silently dropped */
  errors: { file: string; message: string }[]
  /** keyed by `itemKey(name)` (lowercased base name), for every item any build names */
  sources: Record<string, ItemSource | null>
  /** the active character's newest dump, or null when the command has never been run */
  worn: { path: string; loadedAt: string; cells: WornCells } | null
}

const PLAN_SLOT_SET: ReadonlySet<string> = new Set<string>(PLAN_SLOTS)
const EXALT_KIND_SET: ReadonlySet<string> = new Set<string>(EXALT_KINDS)

/** A name as the comparison and the corpus key see it: base name, case folded. */
export function itemNameKey(name: string): string {
  return parseItemName(name.trim()).base.toLowerCase()
}

/** The display base name: ` +N`, `*` and ` (Exaltation)` stripped. */
function baseName(name: string): string {
  return parseItemName(name.trim()).base
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function nonEmptyString(v: unknown, what: string): string {
  if (typeof v !== 'string' || v.trim() === '') throw new Error(`${what} must be a non-empty string`)
  return v
}

/**
 * THE ONE VALIDATOR for a build file. Throws with a message naming the offending field; main turns
 * a throw into a `BuildsPayload.errors` row. Names are normalized to base names here, so a hand-
 * written `Darkbrood Mask +10` reads the same as the importer's `Darkbrood Mask`.
 */
export function parseBuildFile(id: string, raw: unknown): Build {
  if (!isRecord(raw)) throw new Error('a build file must be a JSON object')
  for (const key of Object.keys(raw)) {
    if (key !== 'name' && key !== 'url' && key !== 'slots') throw new Error(`unknown field "${key}"`)
  }
  const build: Build = { id, name: raw.name === undefined ? id : nonEmptyString(raw.name, 'name'), slots: {} }
  if (raw.url !== undefined) build.url = nonEmptyString(raw.url, 'url')
  if (!isRecord(raw.slots)) throw new Error('"slots" must be an object keyed by cell')
  for (const [cell, value] of Object.entries(raw.slots)) {
    if (!PLAN_SLOT_SET.has(cell)) throw new Error(`unknown cell "${cell}" (expected one of ${PLAN_SLOTS.join(', ')})`)
    build.slots[cell as PlanSlotId] = parseBuildItem(`slots.${cell}`, value)
  }
  return build
}

function parseBuildItem(at: string, value: unknown): BuildItem {
  if (!isRecord(value)) throw new Error(`${at} must be an object`)
  for (const key of Object.keys(value)) {
    if (key !== 'name' && key !== 'exaltations') throw new Error(`${at}: unknown field "${key}"`)
  }
  const item: BuildItem = { name: baseName(nonEmptyString(value.name, `${at}.name`)) }
  if (value.exaltations === undefined) return item
  if (!isRecord(value.exaltations)) throw new Error(`${at}.exaltations must be an object`)
  const ex: Exaltations = {}
  for (const [kind, donor] of Object.entries(value.exaltations)) {
    if (!EXALT_KIND_SET.has(kind)) throw new Error(`${at}.exaltations: unknown kind "${kind}" (expected ${EXALT_KINDS.join(', ')})`)
    ex[kind as ExaltKind] = baseName(nonEmptyString(donor, `${at}.exaltations.${kind}`))
  }
  item.exaltations = ex
  return item
}

/** What the dump says is on each cell, with the donors in its four exaltation sockets. */
export function wornCells(dump: InventoryDump): WornCells {
  const out: WornCells = {}
  for (const { cell, entry } of equippedEntries(dump)) {
    const parsed = parseItemName(entry.name)
    const exaltations: Exaltations = {}
    for (const child of entry.children) {
      const kind = child.path.length === 1 ? SOCKET_KIND[child.path[0]] : undefined
      if (kind === undefined || child.empty) continue
      exaltations[kind] = parseItemName(child.name).base
    }
    const item: WornItem = { name: parsed.base, exaltations }
    if (parsed.tier !== undefined) item.tier = parsed.tier
    out[cell] = item
  }
  return out
}

export interface ExaltCompare {
  kind: ExaltKind
  build: string
  /** the donor in that socket on your body, absent when the socket is empty or the cell is */
  worn?: string
  differs: boolean
}

export interface CompareRow {
  cell: PlanSlotId
  build: BuildItem
  worn: WornItem | null
  /** the build's item is not the item on this cell (base name, case-insensitive; +N ignored) */
  differs: boolean
  /** one row per kind the build names, in socket order */
  exaltations: ExaltCompare[]
}

/** The build against the body, one row per cell the build names, in `PLAN_SLOTS` order. */
export function compareBuild(build: Build, worn: WornCells): CompareRow[] {
  const rows: CompareRow[] = []
  for (const cell of PLAN_SLOTS) {
    const item = build.slots[cell]
    if (item === undefined) continue
    const on = worn[cell] ?? null
    const exaltations: ExaltCompare[] = []
    for (const kind of EXALT_KINDS) {
      const want = item.exaltations?.[kind]
      if (want === undefined) continue
      const have = on?.exaltations[kind]
      const row: ExaltCompare = { kind, build: want, differs: have === undefined || itemNameKey(have) !== itemNameKey(want) }
      if (have !== undefined) row.worn = have
      exaltations.push(row)
    }
    rows.push({
      cell,
      build: item,
      worn: on,
      differs: on === null || itemNameKey(on.name) !== itemNameKey(item.name),
      exaltations
    })
  }
  return rows
}

/** How many cells differ in item or in a named exaltation — the tab's summary line. */
export function differingCells(rows: readonly CompareRow[]): number {
  return rows.filter((r) => r.differs || r.exaltations.some((e) => e.differs)).length
}

/** "Innoruuk @ Plane of Hate", "Quest: Wizard Test of Focus" — the lines a source renders as. */
export function sourceLines(source: ItemSource | null): string[] {
  if (source === null) return []
  return [
    ...source.drops.map((d) => (d.zone === undefined ? d.mob : `${d.mob} @ ${d.zone}`)),
    ...source.quests.map((q) => `Quest: ${q}`)
  ]
}
