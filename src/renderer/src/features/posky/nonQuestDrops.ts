// posky/nonQuestDrops.ts — Plane of Sky drops that no quest asks for.
//
// The Cleanup tab's first table only knows items some Sky quest names. A Sky farmer also carries
// what the 65 Sky mobs drop beside those: gems, globes, statuettes, gear. This lists every item a
// Sky mob's `|known_loot` names that no quest requires — not a Sky quest (posky.json) and not any
// quest in the wiki catalog (quests.json), since a handful of Sky drops (Bird Whistle, the Key of
// Swords) are turn-ins for quests outside the Sky tracker.
//
// EPIC QUESTS ARE THE EXCEPTION. A drop that only class epics require (Blade of Abrogation, Spiroc
// Feathers) is listed anyway, marked with the epic's class, because it is the drop a player most
// needs to see before deleting. The same mark goes on the Cleanup table's own rows.
//
// "Requires" means a turn-in item. A quest REWARD that also drops is still listed: handing it out
// does not make anyone want it back.
//
// Pure, like `cleanup.ts`: `nonQuestDrops` takes its inputs, and `skyNonQuestDrops` is the one
// place the committed data is read. The value imports are RELATIVE for the node test.

import type { MobEntry } from '../../../../shared/types'
import { renameItemName } from '../../../../shared/itemRenames'
import { itemCountKey, normalizeItemName } from '../../lib/itemName'
import questsJson from '../../data/eqlegends/quests.json'
import poskyJson from '../../data/eqlegends/posky.json'
import { dropperNameOrder, skyMobs, type DropperMob } from './poskyDroppers'
import type { DumpLocations, CleanupLocation } from './cleanup'

/** One Sky drop no quest requires, and who drops it. */
export interface NonQuestDrop {
  /** the counting key, through the rename overlay */
  key: string
  /** the catalog's spelling, `+N` stripped */
  name: string
  droppers: readonly DropperMob[]
  /** classes whose epic quest requires it; empty for most drops */
  epics: readonly string[]
}

/** A quest from the wiki catalog, as far as this module reads it. */
export interface CatalogQuest {
  name: string
  requiredItems?: readonly string[]
}

/** item counting key → the classes whose epic requires it. */
export type EpicClasses = ReadonlyMap<string, readonly string[]>

const EPIC_QUEST = /^(.+) Epic Quest$/

/** The catalog names each class epic `<Class> Epic Quest`; index their turn-ins by class. */
export function epicClassesByItem(quests: readonly CatalogQuest[]): EpicClasses {
  const out = new Map<string, string[]>()
  for (const q of quests) {
    const cls = EPIC_QUEST.exec(q.name)?.[1]
    if (!cls) continue
    for (const name of q.requiredItems ?? []) {
      const classes = out.get(dropKey(name)) ?? []
      if (!classes.includes(cls)) classes.push(cls)
      out.set(dropKey(name), classes)
    }
  }
  return out
}

/** A non-quest drop with what the loaded export says you hold of it. */
export interface NonQuestDropRow extends NonQuestDrop {
  /** summed over `locations`; 0 when the export never named it */
  held: number
  locations: readonly CleanupLocation[]
}

function dropKey(name: string): string {
  return itemCountKey(renameItemName(name))
}

function toDropper(m: MobEntry): DropperMob {
  const dropper: DropperMob = { name: m.name, page: m.page, zones: m.zones ?? [], entry: m }
  if (m.level) dropper.level = m.level
  return dropper
}

/**
 * Every item `mobs` drop whose key is not in `required`, sorted by name. `required` holds the
 * non-epic turn-ins; `epics` marks the rows class epics want.
 */
export function nonQuestDrops(
  mobs: readonly MobEntry[],
  required: Iterable<string>,
  epics: EpicClasses
): NonQuestDrop[] {
  const wanted = new Set<string>()
  for (const name of required) wanted.add(dropKey(name))
  const byKey = new Map<string, { name: string; droppers: DropperMob[] }>()
  for (const m of mobs) {
    for (const drop of m.drops ?? []) {
      const key = dropKey(drop)
      if (key === '' || wanted.has(key)) continue
      let entry = byKey.get(key)
      if (!entry) {
        entry = { name: normalizeItemName(renameItemName(drop)), droppers: [] }
        byKey.set(key, entry)
      }
      if (!entry.droppers.some((d) => d.page === m.page)) entry.droppers.push(toDropper(m))
    }
  }
  return [...byKey]
    .map(([key, e]) => ({
      key,
      name: e.name,
      droppers: [...e.droppers].sort(dropperNameOrder),
      epics: epics.get(key) ?? []
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** The drops joined with the export's places: what you hold first (biggest stack), then by name. */
export function nonQuestDropRows(
  drops: readonly NonQuestDrop[],
  locations: DumpLocations
): NonQuestDropRow[] {
  return drops
    .map((d) => {
      const places = locations[d.key] ?? []
      return { ...d, locations: places, held: places.reduce((n, p) => n + p.count, 0) }
    })
    .sort((a, b) => b.held - a.held || a.name.localeCompare(b.name))
}

let SKY_NON_QUEST: NonQuestDrop[] | null = null
let EPICS: EpicClasses | null = null

function catalogEpics(): EpicClasses {
  EPICS ??= epicClassesByItem(questsJson.quests)
  return EPICS
}

/** The classes whose epic requires this item, from the committed quest catalog. */
export function epicClassesOf(name: string): readonly string[] {
  return catalogEpics().get(dropKey(name)) ?? []
}

/** The committed data's answer, computed once on first use. */
export function skyNonQuestDrops(): readonly NonQuestDrop[] {
  if (SKY_NON_QUEST) return SKY_NON_QUEST
  const required: string[] = []
  for (const q of poskyJson.quests) for (const it of q.items) required.push(it.name)
  for (const q of questsJson.quests) {
    if (!EPIC_QUEST.test(q.name)) required.push(...(q.requiredItems ?? []))
  }
  SKY_NON_QUEST = nonQuestDrops(skyMobs(), required, catalogEpics())
  return SKY_NON_QUEST
}

/** `Necromancer epic`, `Magician, Necromancer epics` — the mark a row carries. */
export function epicLabel(classes: readonly string[]): string {
  return `${classes.join(', ')} epic${classes.length === 1 ? '' : 's'}`
}
