// planner/moteXp.ts — the mote catalog and the XP curve the mote planner counts in.
//
// Source for the catalog: eqlwiki.com/Mote_Guide. The rules these encode are listed in motes.ts.

import type { ItemUpgradeState } from '../itemUpgrade'
import { ITEM_MAX_TIER, expToNextTier } from '../itemStats'
import type { Selection } from './motes'

export const MOTES = [
  {
    name: 'Mote of Infinitesimal Potential',
    itemXp: 1,
    itemCap: 0,
    spellXp: 1
  },
  { name: 'Mote of Minor Potential', itemXp: 1, itemCap: 1, spellXp: 2 },
  { name: 'Mote of Lesser Potential', itemXp: 2, itemCap: 2, spellXp: 4 },
  { name: 'Mote of Potential', itemXp: 4, itemCap: 3, spellXp: 8 },
  { name: 'Mote of Major Potential', itemXp: 5, itemCap: 4, spellXp: 16 },
  { name: 'Mote of Greater Potential', itemXp: 6, itemCap: 5, spellXp: 32 },
  { name: 'Mote of Superior Potential', itemXp: 7, itemCap: 6, spellXp: 64 },
  { name: 'Mote of Grand Potential', itemXp: 8, itemCap: 7, spellXp: 128 },
  { name: 'Mote of Ascendant Potential', itemXp: 9, itemCap: 8, spellXp: 256 },
  { name: 'Mote of Infinite Potential', itemXp: 10, itemCap: 9, spellXp: 512 }
] as const

export type MoteName = (typeof MOTES)[number]['name']

/** Highest tier index condensing may produce (Ascendant). */
export const CONDENSE_MAX_INDEX = 8

/** XP a spare copy at `tier` merges in for. */
export function mergeXp(tier: number): number {
  return 2 ** tier
}

/** Highest tier a spare copy can be for merging (the wiki lists no merge XP for +10). */
export const SPARE_MAX_TIER = ITEM_MAX_TIER - 1

/** Cumulative XP to reach `rank`. */
export function cumXp(rank: number): number {
  let total = 0
  for (let r = 0, step = expToNextTier(r); r < rank && step !== null; step = expToNextTier(++r)) total += step
  return total
}

export const MAX_XP = cumXp(ITEM_MAX_TIER)

export function stateAt(xp: number): ItemUpgradeState {
  let full = 0
  let rest = xp
  for (let step = expToNextTier(full); step !== null && rest >= step; step = expToNextTier(full)) {
    rest -= step
    full++
  }
  return { full, fraction: rest }
}

/** Cumulative XP of a selection's starting state. */
export function startXp(sel: Selection): number {
  return cumXp(sel.from) + (sel.fraction ?? 0)
}
