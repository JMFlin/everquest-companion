// IPC: the BUILDS tab's and overlay's one read (src/shared/builds.ts states the feature).
//
// `builds:get` reads `<userData>/builds/*.json` (one readdir and a handful of tiny files — no
// cache, no watcher: the tab and overlay re-ask on open, on Reload and on `inventory:autoReloaded`),
// validates each file through the shared validator, resolves every named item's source from the
// committed corpus, and adds what the active character wears: their newest dump, and the saved
// copy per class loadout (wornLoadouts.ts). The read also files the newest dump under its loadout,
// so a dump whose `/who` reached the log a moment after it is still filed once the tab re-asks.
//
// A file that fails to parse or validate is returned as an error row with the reason, never
// dropped: a hand-written build with a typo should say so on screen.

import { ipcMain, app } from 'electron'
import { mkdirSync, readdirSync, readFileSync } from 'fs'
import { join, parse } from 'path'
import { IPC } from '../../shared/ipc'
import {
  itemNameKey,
  parseBuildFile,
  wornCells,
  type Build,
  type BuildsPayload,
  type ItemSource,
  type WornDump
} from '../../shared/builds'
import { loadInventoryDump } from '../outputs'
import { getActiveCharacter } from '../session'
import { archiveWornLoadout, readWornLoadouts } from '../wornLoadouts'
import type { CharacterRef } from '../../shared/types'
import { buildItemDbIndex, itemKey, type ItemDbEntry, type ItemDbFile } from '../itemsDb'
// The COMMITTED wiki item database — the same module itemLookup.ts imports, so the JSON is
// inlined into the main bundle exactly once.
import itemsJson from '../data/items.json'

let index: Map<string, ItemDbEntry> | null = null

/** The name→record index, built on first use and kept for the process's life (planner precedent). */
function itemIndex(): Map<string, ItemDbEntry> {
  index ??= buildItemDbIndex(itemsJson as unknown as ItemDbFile)
  return index
}

function sourceOf(name: string): ItemSource | null {
  const record = itemIndex().get(itemKey(name))
  if (record === undefined) return null
  return {
    drops: (record.dropsFrom ?? []).map((d) => (d.zone === undefined ? { mob: d.mob } : { mob: d.mob, zone: d.zone })),
    quests: (record.questUses ?? []).map((q) => q.quest)
  }
}

function readBuilds(dir: string): Pick<BuildsPayload, 'builds' | 'errors'> {
  mkdirSync(dir, { recursive: true })
  const builds: Build[] = []
  const errors: BuildsPayload['errors'] = []
  for (const file of readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.json'))
    .sort()) {
    try {
      builds.push(parseBuildFile(parse(file).name, JSON.parse(readFileSync(join(dir, file), 'utf8'))))
    } catch (err) {
      errors.push({ file, message: err instanceof Error ? err.message : String(err) })
    }
  }
  builds.sort((a, b) => a.name.localeCompare(b.name))
  return { builds, errors }
}

/** Where the per-loadout dump copies live. */
function wornLoadoutsDir(): string {
  return join(app.getPath('userData'), 'worn-loadouts')
}

/**
 * The character's newest dump, filed under its loadout when a `/who` pairs with it. Also called by
 * the session on every dump re-read, so a dump is filed before the next one overwrites it.
 */
export function fileNewestDump(character: CharacterRef): WornDump | null {
  const loaded = loadInventoryDump(character.name, character.server)
  if (loaded === null) return null
  const dump = { loadedAt: loaded.loadedAt, cells: wornCells(loaded.dump) }
  const classes = archiveWornLoadout(wornLoadoutsDir(), character, dump)
  return classes === null ? dump : { ...dump, classes }
}

function readWorn(character: CharacterRef | null): Pick<BuildsPayload, 'worn' | 'loadouts'> {
  if (character === null) return { worn: null, loadouts: {} }
  const worn = fileNewestDump(character)
  return { worn, loadouts: readWornLoadouts(wornLoadoutsDir(), character) }
}

export function registerBuildsIpc(): void {
  ipcMain.handle(IPC.buildsGet, (): BuildsPayload => {
    const dir = join(app.getPath('userData'), 'builds')
    const { builds, errors } = readBuilds(dir)
    const sources: BuildsPayload['sources'] = {}
    for (const build of builds) {
      for (const item of Object.values(build.slots)) sources[itemNameKey(item.name)] ??= sourceOf(item.name)
    }
    return { dir, builds, errors, sources, ...readWorn(getActiveCharacter()) }
  })
}
