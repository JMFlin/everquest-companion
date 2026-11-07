// main/uiLayouts.ts — the file work behind saved EverQuest UI layouts (src/shared/uiLayouts.ts
// states the feature). Electron-free: every root is an argument, so tests drive real copies in a
// temp dir.
//
// Storage: `<store>\<name>\UI_*.ini` plus `layout.json` ({ savedAt }). Applying a layout first
// copies the install folder's current `UI_*.ini` files to `<backup>` (replacing the previous
// backup), so an unsaved layout overwritten by mistake can still be recovered by hand.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { isUiLayoutFile, type UiLayout } from '../shared/uiLayouts'

const META = 'layout.json'

function uiFiles(dir: string): string[] {
  return readdirSync(dir).filter(isUiLayoutFile).sort()
}

function copyAll(files: string[], from: string, to: string): void {
  for (const f of files) copyFileSync(join(from, f), join(to, f))
}

export function listUiLayouts(store: string): UiLayout[] {
  if (!existsSync(store)) return []
  return readdirSync(store, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const dir = join(store, d.name)
      const meta = JSON.parse(readFileSync(join(dir, META), 'utf8')) as { savedAt: number }
      return { name: d.name, savedAt: meta.savedAt, files: uiFiles(dir) }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Copy every `UI_*.ini` in `eqRoot` into the layout `name`, replacing what it held. */
export function saveUiLayout(eqRoot: string, store: string, name: string, now: number): void {
  const files = uiFiles(eqRoot)
  if (files.length === 0) throw new Error(`No UI_*.ini files in ${eqRoot}. Log in a character once first.`)
  const dir = join(store, name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  copyAll(files, eqRoot, dir)
  writeFileSync(join(dir, META), JSON.stringify({ savedAt: now }))
}

/** Back up the install folder's current `UI_*.ini` files to `backup`, then copy the layout in. */
export function applyUiLayout(eqRoot: string, store: string, name: string, backup: string): void {
  const dir = join(store, name)
  if (!existsSync(join(dir, META))) throw new Error(`No saved layout named "${name}".`)
  rmSync(backup, { recursive: true, force: true })
  mkdirSync(backup, { recursive: true })
  copyAll(uiFiles(eqRoot), eqRoot, backup)
  copyAll(uiFiles(dir), dir, eqRoot)
}

export function deleteUiLayout(store: string, name: string): void {
  rmSync(join(store, name), { recursive: true, force: true })
}
