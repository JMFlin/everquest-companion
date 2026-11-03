// posky/nonQuestDrops.ts — Plane of Sky drops that no quest asks for.
//
// The Cleanup tab's first table only knows items some Sky quest names. A Sky farmer also carries
// what the 65 Sky mobs drop beside those: gems, globes, statuettes, gear. This lists every item a
// Sky mob's `|known_loot` names that no quest requires — not a Sky quest (posky.json) and not any
// quest in the wiki catalog (quests.json), since a handful of Sky drops (Bird Whistle, the Key of
// Swords) are turn-ins for quests outside the Sky tracker.
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

/** Every item `mobs` drop whose key is not in `required`, sorted by name. */
export function nonQuestDrops(
  mobs: readonly MobEntry[],
  required: Iterable<string>
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
    .map(([key, e]) => ({ key, name: e.name, droppers: [...e.droppers].sort(dropperNameOrder) }))
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

/** The committed data's answer, computed once on first use. */
export function skyNonQuestDrops(): readonly NonQuestDrop[] {
  if (SKY_NON_QUEST) return SKY_NON_QUEST
  const required: string[] = []
  for (const q of poskyJson.quests) for (const it of q.items) required.push(it.name)
  for (const q of questsJson.quests) required.push(...(q.requiredItems ?? []))
  SKY_NON_QUEST = nonQuestDrops(skyMobs(), required)
  return SKY_NON_QUEST
}
