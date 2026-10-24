// The closed set of names a currencies-window row may resolve to, and the OCR-text → name match.

import { MOTES } from '../../shared/planner/motes'
import type { ItemDbFile } from '../itemsDb'
import itemsJson from '../data/items.json'

const WIND_RUNE_KEY = 'wind rune '

let vocabulary: readonly string[] | null = null

/** Every mote name plus every Wind Rune page title in the committed item corpus. */
export function currencyVocabulary(): readonly string[] {
  vocabulary ??= [
    ...MOTES.map((m) => m.name),
    ...Object.entries((itemsJson as unknown as ItemDbFile).items)
      .filter(([key]) => key.startsWith(WIND_RUNE_KEY))
      .map(([, entry]) => entry.page)
  ]
  return vocabulary
}

/**
 * The window spells stacks in the plural and runes suffix-first ("Azia Wind Runes");
 * rewrite to the item name ("Wind Rune Azia"). Leading icon junk is stripped.
 */
export function normalizeRowText(text: string): string {
  const t = text.replace(/^[^A-Za-z]+/, '').replace(/\s+/g, ' ').trim()
  const rune = /^(\S+) Wind Runes?$/i.exec(t)
  if (rune) return `Wind Rune ${rune[1]}`
  return t.replace(/^\S*otes of /i, 'Mote of ')
}

/**
 * Closest vocabulary name by edit distance over `fold`ed text, or null when the best is
 * farther than 20% of its length or tied with a different name.
 */
export function matchCurrencyName(text: string, vocab: readonly string[]): string | null {
  const needle = fold(normalizeRowText(text))
  let best: string | null = null
  let bestD = Infinity
  let secondD = Infinity
  for (const name of vocab) {
    const d = editDistance(needle, fold(name))
    if (d < bestD) {
      secondD = bestD
      bestD = d
      best = name
    } else if (d < secondD) {
      secondD = d
    }
  }
  if (best === null || bestD > Math.floor(best.length * 0.2) || bestD === secondD) return null
  return best
}

/** Lowercase, with OCR look-alikes (l/I/1, O/0) collapsed on both sides of the compare. */
function fold(s: string): string {
  return s.toLowerCase().replace(/[l1]/g, 'i').replace(/0/g, 'o')
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}
