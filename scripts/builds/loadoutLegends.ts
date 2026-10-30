// builds/loadoutLegends.ts — a loadoutlegends.com character page → a build file (src/shared/builds.ts).
//
// loadoutlegends.com is a THIRD-PARTY site this repo does not control, so this parser is pinned to
// a committed copy of a real page (tests/fixtures/loadoutlegends-larlen.html) and never called live
// by a test. If the site changes shape, the parser throws rather than writing a half build.
//
// WHERE THE GEAR IS. The page is a Next.js app: the equipped gear rides in the RSC flight payload,
// a series of `self.__next_f.push([1,"<js string>"])` chunks. Decoded and concatenated, the payload
// carries one JSON object per item, e.g.
//   {"id":"1544","name":"Darkbrood Mask","slot":3,…,"location":"Face","itemLevel":10,
//    "exaltations":[{"id":"4505","slot":"Focus","definition":"Polished Mithril Mask (Exaltation)",…}]}
// `location` is the site's slot label; `slot` is the client's equipment index (0..21), the same
// order the inventory dump prints, which is how the labels below map onto planner cells: 0 Charm
// and 21 Power are the dump's two `Any Slot` rows (ANY1, ANY2).
//
// Sources are deliberately NOT taken from the page: the app resolves them from its own corpus.

import type { ExaltKind } from '../../src/shared/builds'
import type { PlanSlotId } from '../../src/shared/planner/types'

/** The file shape `parseBuildFile` accepts — what the importer writes. */
export interface BuildFileJson {
  name: string
  url: string
  slots: Partial<Record<PlanSlotId, { name: string; exaltations?: Partial<Record<ExaltKind, string>> }>>
}

const CELL_OF_LOCATION: Readonly<Record<string, PlanSlotId>> = {
  Charm: 'ANY1',
  Ear1: 'EAR',
  Head: 'HEAD',
  Face: 'FACE',
  Ear2: 'EAR2',
  Neck: 'NECK',
  Shoulders: 'SHOULDERS',
  Arms: 'ARMS',
  Back: 'BACK',
  Wrist1: 'WRIST',
  Wrist2: 'WRIST2',
  Range: 'RANGE',
  Hands: 'HANDS',
  Primary: 'PRIMARY',
  Secondary: 'SECONDARY',
  Finger1: 'FINGER',
  Finger2: 'FINGER2',
  Chest: 'CHEST',
  Legs: 'LEGS',
  Feet: 'FEET',
  Waist: 'WAIST',
  Power: 'ANY2',
  Ammo: 'AMMO'
}

/** Locations that are not worn: bags and pets. Anything else unmapped is a site change → throw. */
const NOT_WORN = /^(General|Pet|Bank|SharedBank)\d/

const KIND_OF_SOCKET: Readonly<Record<string, ExaltKind>> = {
  Focus: 'focus',
  Click: 'click',
  Worn: 'worn',
  Proc: 'proc'
}

interface PageItem {
  name: string
  location: string
  exaltations: { slot: string; definition: string }[]
}

/** Decode every flight chunk and join them: the payload as the browser would read it. */
function flightPayload(html: string): string {
  const chunks: string[] = []
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    chunks.push(JSON.parse(m[1]) as string)
  }
  if (chunks.length === 0) throw new Error('no Next.js flight payload found - has loadoutlegends.com changed?')
  return chunks.join('')
}

/** The balanced `{…}` starting at `start`, string-aware. */
function objectAt(text: string, start: number): string {
  let depth = 0
  let inString = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (c === '\\') i++
      else if (c === '"') inString = false
    } else if (c === '"') inString = true
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return text.slice(start, i + 1)
  }
  throw new Error('unterminated item object in the flight payload')
}

function pageItems(payload: string): PageItem[] {
  const out: PageItem[] = []
  for (const m of payload.matchAll(/\{"id":"\d+","name":"/g)) {
    const obj = JSON.parse(objectAt(payload, m.index)) as Record<string, unknown>
    if (typeof obj.location !== 'string' || !Array.isArray(obj.exaltations)) continue
    out.push(obj as unknown as PageItem)
  }
  return out
}

/** "Larlen - Rivervale EverQuest Legends Character | …" + `?loadout=WIZ%2FBRD%2FENC` → "Larlen (WIZ/BRD/ENC)". */
function defaultName(html: string): string {
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1]
  const character = title?.split(' - ')[0]?.trim()
  if (!character) throw new Error('no character name in the page title')
  const loadout = /[?&]loadout=([^"&\\]+)/.exec(html)?.[1]
  return loadout === undefined ? character : `${character} (${decodeURIComponent(loadout)})`
}

const EXALTATION_SUFFIX = ' (Exaltation)'

export function parseLoadoutPage(html: string, url: string): BuildFileJson {
  const build: BuildFileJson = { name: defaultName(html), url, slots: {} }
  for (const item of pageItems(flightPayload(html))) {
    if (NOT_WORN.test(item.location)) continue
    const cell = CELL_OF_LOCATION[item.location]
    if (cell === undefined) throw new Error(`unknown slot "${item.location}" - has loadoutlegends.com changed?`)
    // The payload repeats an item wherever the page renders it; the first is the worn cell.
    if (build.slots[cell] !== undefined) continue
    const exaltations: Partial<Record<ExaltKind, string>> = {}
    for (const ex of item.exaltations) {
      const kind = KIND_OF_SOCKET[ex.slot]
      if (kind === undefined) throw new Error(`unknown exaltation socket "${ex.slot}" on ${item.name}`)
      exaltations[kind] = ex.definition.endsWith(EXALTATION_SUFFIX)
        ? ex.definition.slice(0, -EXALTATION_SUFFIX.length)
        : ex.definition
    }
    build.slots[cell] = Object.keys(exaltations).length > 0 ? { name: item.name, exaltations } : { name: item.name }
  }
  if (Object.keys(build.slots).length === 0) throw new Error('no worn gear found on the page')
  return build
}
