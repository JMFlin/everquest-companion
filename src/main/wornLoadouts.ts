// wornLoadouts.ts — one saved copy of the worn gear per class loadout, so a dump survives the next one.
//
// `/outputfile inventory` always overwrites the same file, but an EQ Legends character wears
// different gear per class loadout (PAL/MNK/ENC vs BST/SHM/ENC). The dump itself names no class,
// and the log never prints a loadout swap: the character's own `/who` row is the only line that
// states the loadout. So a dump is filed under a loadout only when a self `/who` row was printed
// within PAIR_WINDOW_MS of the dump's mtime (the owner runs one macro: `/who`, then the dump).
// An unpaired dump is not filed anywhere — a guessed loadout would silently compare the wrong gear.
//
// Each copy is `<dir>/<Name>_<server>/<CLS-CLS-CLS>.json` holding the worn cells, keyed by the
// sorted class set (`loadoutKey`), so a newer dump of the same loadout replaces only its own copy.
//
// No Electron here: callers pass the folder, so tests drive it with a temp dir.

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import { loadoutKey, parseLoadoutClasses, type WornDump, type WornCells } from '../shared/builds'
import type { CharacterRef } from '../shared/types'

/** How far a `/who` row may sit from the dump's mtime and still name its loadout. */
export const PAIR_WINDOW_MS = 60_000

/** Bytes of the log's end searched for the `/who` row; a macro prints it seconds before the dump. */
const TAIL_BYTES = 512 * 1024

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The self `/who` row nearest `atMs` (within the window) in a slice of the log, as its classes.
 * Same row grammar as the log parser's selfWho rule (shared/logEvents.ts SelfWhoEvent).
 */
export function selfWhoNear(logText: string, name: string, atMs: number): string[] | null {
  const row = new RegExp(
    `^\\[\\w{3} (\\w{3}) (\\d{2}) (\\d{2}):(\\d{2}):(\\d{2}) (\\d{4})\\] \\s*(?:\\* RIP \\*\\s*)?(?:AFK\\s+)?\\[\\d+ ([A-Z]{3}(?:/[A-Z]{3})*)\\] ${escapeRe(name)}\\b`,
    'gm'
  )
  let best: { gap: number; classes: string[] } | null = null
  for (const m of logText.matchAll(row)) {
    const ts = new Date(+m[6], MONTHS.indexOf(m[1]), +m[2], +m[3], +m[4], +m[5]).getTime()
    const gap = Math.abs(ts - atMs)
    if (gap <= PAIR_WINDOW_MS && (best === null || gap < best.gap)) best = { gap, classes: m[7].split('/') }
  }
  return best?.classes ?? null
}

function logTail(path: string): string {
  const size = statSync(path).size
  const length = Math.min(size, TAIL_BYTES)
  const buf = Buffer.alloc(length)
  const fd = openSync(path, 'r')
  try {
    readSync(fd, buf, 0, length, size - length)
  } finally {
    closeSync(fd)
  }
  return buf.toString('utf8')
}

function characterDir(dir: string, character: CharacterRef): string {
  return join(dir, `${character.name}_${character.server}`)
}

/**
 * File the dump under its loadout when a `/who` pairs with it. Returns the loadout it was filed
 * under, or null when no `/who` row sits near the dump (nothing written).
 */
export function archiveWornLoadout(
  dir: string,
  character: CharacterRef,
  dump: { loadedAt: string; cells: WornCells }
): string | null {
  const classes = selfWhoNear(logTail(character.logPath), character.name, Date.parse(dump.loadedAt))
  if (classes === null) return null
  const key = loadoutKey(parseLoadoutClasses(classes.join('/'), 'the /who row'))
  const out = characterDir(dir, character)
  mkdirSync(out, { recursive: true })
  const saved: WornDump = { loadedAt: dump.loadedAt, classes: key, cells: dump.cells }
  writeFileSync(join(out, `${key.replaceAll('/', '-')}.json`), JSON.stringify(saved, null, 2) + '\n')
  return key
}

/** Every saved loadout copy of this character, keyed by `loadoutKey`. Our own files: read as written. */
export function readWornLoadouts(dir: string, character: CharacterRef): Record<string, WornDump> {
  const from = characterDir(dir, character)
  const out: Record<string, WornDump> = {}
  if (!existsSync(from)) return out
  for (const file of readdirSync(from)) {
    if (!file.endsWith('.json')) continue
    const saved = JSON.parse(readFileSync(join(from, file), 'utf8')) as WornDump & { classes: string }
    out[saved.classes] = saved
  }
  return out
}
