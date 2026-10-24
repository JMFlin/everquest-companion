// planner/motes.ts — which held motes to spend on a spell rank-up and a gear tier-up.
//
// Source for the catalog: eqlwiki.com/Mote_Guide. Rules below are owner-confirmed.
//
// RULES
// - Spell ranks and gear tiers run 0..10. Going r -> r+1 costs 2^r XP (`expToNextTier`, the one
//   home of that curve), so reaching r takes 2^r - 1 cumulative XP and 10 sits at 1023. XP past
//   1023 is impossible: no plan ever applies a mote that would push the total over it.
// - XP overflow carries into the next rank, for spells and gear alike.
// - Spells: any mote at any rank, worth `spellXp`.
// - Gear: a mote applies only while the item's CURRENT tier <= `itemCap`, worth `itemXp`.
// - Condense: 2 motes of tier n -> 1 of tier n+1, producing at most Ascendant. Spell value is
//   conserved by condensing (spellXp doubles per tier); gear XP is lost or kept, never gained —
//   condensing only ever helps gear by raising the cap.
//
// ALLOCATION (one shared pool)
// 1. Gear first. Exact DP over (cumulative XP, condensed carry) tier by tier, applying in
//    ascending itemCap order — a lower-cap mote is only harder to place later, so this order never
//    strands a mote another order could use. Lexicographic objective: reach `to` (else most XP),
//    then least spell value consumed, then least overshoot, then fewest condenses. Counts are
//    first clamped to what can ever be used (`usefulBounds`), which keeps hoards of hundreds fast.
// 2. Spell takes what remains: largest-first greedy within the need (powers of two, so the fill is
//    exact whenever exact is possible), then the smallest single mote that completes the goal
//    without passing 1023. Never condenses (neutral for spells).

import type { ItemUpgradeState } from '../itemUpgrade'
import { ITEM_MAX_TIER, expToNextTier } from '../itemStats'

export const MOTES = [
  { name: 'Mote of Infinitesimal Potential', itemXp: 1, itemCap: 0, spellXp: 1 },
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
const CONDENSE_MAX_INDEX = 8

export interface Selection {
  from: number
  to: number
}

export type Step =
  | { kind: 'condense'; mote: MoteName; pairs: number; into: MoteName }
  | { kind: 'apply'; mote: MoteName; count: number; after: ItemUpgradeState }

export interface SectionPlan {
  from: number
  to: number
  steps: Step[]
  reached: ItemUpgradeState
  /** XP still missing to reach `to`; 0 when reached. */
  shortfallXp: number
  /** XP past `to`, carrying toward the next rank. */
  overshootXp: number
}

export interface MotePlan {
  spell?: SectionPlan
  gear?: SectionPlan
  remaining: Record<MoteName, number>
}

/** Cumulative XP to reach `rank`. */
function cumXp(rank: number): number {
  let total = 0
  for (let r = 0, step = expToNextTier(r); r < rank && step !== null; step = expToNextTier(++r)) total += step
  return total
}

const MAX_XP = cumXp(ITEM_MAX_TIER)

function stateAt(xp: number): ItemUpgradeState {
  let full = 0
  let rest = xp
  for (let step = expToNextTier(full); step !== null && rest >= step; step = expToNextTier(full)) {
    rest -= step
    full++
  }
  return { full, fraction: rest }
}

function validateSelection(sel: Selection, label: string): void {
  const { from, to } = sel
  if (!Number.isInteger(from) || from < 0 || from > ITEM_MAX_TIER - 1) {
    throw new Error(`${label}.from must be an integer 0..${ITEM_MAX_TIER - 1}, got ${from}`)
  }
  if (!Number.isInteger(to) || to <= from || to > ITEM_MAX_TIER) {
    throw new Error(`${label}.to must be an integer ${from + 1}..${ITEM_MAX_TIER}, got ${to}`)
  }
}

interface DpNode {
  value: number
  pairs: number
  prev: DpNode | null
  applied: number
  condensed: number
}

/** Keeps the cheaper (value, then condense pairs) of two ways into the same DP state. */
function keepBetter(layer: Map<number, DpNode>, key: number, cand: DpNode): void {
  const prev = layer.get(key)
  if (prev && (prev.value < cand.value || (prev.value === cand.value && prev.pairs <= cand.pairs))) return
  layer.set(key, cand)
}

/**
 * Per tier: how many held motes can ever be used, and how many pairs into the next tier can.
 * A tier applies at most min(ceil(capLimit / itemXp), floor(1023 / itemXp)) times (XP only grows,
 * from 0 at best). Under the fewest-condenses tie-break an optimum spends held motes before
 * condensed ones and condenses nothing it then leaves unused, so tier n+1 draws at most
 * max(0, useful(n+1) - held(n+1)) pairs from tier n. Clamping to these bounds changes no optimum.
 */
function usefulBounds(counts: number[]): { held: number[]; pairs: number[] } {
  const useful: number[] = MOTES.map(() => 0)
  const pairs: number[] = MOTES.map(() => 0)
  for (let i = MOTES.length - 1; i >= 0; i--) {
    const m = MOTES[i]
    const applications = Math.min(Math.ceil(cumXp(m.itemCap + 1) / m.itemXp), Math.floor(MAX_XP / m.itemXp))
    pairs[i] = i < CONDENSE_MAX_INDEX ? Math.max(0, useful[i + 1] - counts[i + 1]) : 0
    useful[i] = applications + 2 * pairs[i]
  }
  return { held: counts.map((c, i) => Math.min(c, useful[i])), pairs }
}

/** Optimal gear plan over `counts` (mutated to what remains). */
function planGear(counts: number[], sel: Selection): SectionPlan {
  const start = cumXp(sel.from)
  const target = cumXp(sel.to)
  const carryKey = (carry: number, xp: number): number => carry * (MAX_XP + 1) + xp
  const bounds = usefulBounds(counts)

  let frontier = new Map<number, DpNode>([
    [carryKey(0, start), { value: 0, pairs: 0, prev: null, applied: 0, condensed: 0 }]
  ])
  MOTES.forEach((mote, i) => {
    const next = new Map<number, DpNode>()
    const capLimit = cumXp(mote.itemCap + 1)
    for (const [key, node] of frontier) {
      const carry = Math.floor(key / (MAX_XP + 1))
      const xp = key % (MAX_XP + 1)
      const avail = bounds.held[i] + carry
      for (let u = 0; u <= avail; u++) {
        // The u-th application happens at xp + (u-1)*itemXp and must land within the cap and 1023.
        if (u > 0 && (xp + (u - 1) * mote.itemXp >= capLimit || xp + u * mote.itemXp > MAX_XP)) break
        const xpAfter = xp + u * mote.itemXp
        const maxPairs = Math.min(Math.floor((avail - u) / 2), bounds.pairs[i])
        for (let p = 0; p <= maxPairs; p++) {
          keepBetter(next, carryKey(p, xpAfter), {
            value: node.value + u * mote.spellXp,
            pairs: node.pairs + p,
            prev: node,
            applied: u,
            condensed: p
          })
        }
      }
    }
    frontier = next
  })

  // After Infinite (never condensed) every key has carry 0, so the key IS the final XP.
  const [, best] = [...frontier].reduce((a, b) => {
    const better =
      Math.min(b[0], target) - Math.min(a[0], target) ||
      a[1].value - b[1].value ||
      Math.max(0, a[0] - target) - Math.max(0, b[0] - target) ||
      a[1].pairs - b[1].pairs
    return better > 0 ? b : a
  })

  const applied: number[] = MOTES.map(() => 0)
  const condensed: number[] = MOTES.map(() => 0)
  let node = best
  for (let i = MOTES.length - 1; node.prev; i--) {
    applied[i] = node.applied
    condensed[i] = node.condensed
    node = node.prev
  }

  const steps: Step[] = []
  MOTES.forEach((mote, i) => {
    if (condensed[i] > 0) {
      steps.push({ kind: 'condense', mote: mote.name, pairs: condensed[i], into: MOTES[i + 1].name })
    }
  })
  let xp = start
  MOTES.forEach((mote, i) => {
    counts[i] += (i > 0 ? condensed[i - 1] : 0) - applied[i] - 2 * condensed[i]
    if (applied[i] === 0) return
    xp += applied[i] * mote.itemXp
    steps.push({ kind: 'apply', mote: mote.name, count: applied[i], after: stateAt(xp) })
  })
  return section(sel, steps, xp, target)
}

/** Spell plan over `counts` (mutated to what remains). */
function planSpell(counts: number[], sel: Selection): SectionPlan {
  const target = cumXp(sel.to)
  let xp = cumXp(sel.from)
  const used: number[] = MOTES.map(() => 0)
  for (let i = MOTES.length - 1; i >= 0; i--) {
    used[i] = Math.min(counts[i], Math.floor((target - xp) / MOTES[i].spellXp))
    xp += used[i] * MOTES[i].spellXp
  }
  if (xp < target) {
    const finisher = MOTES.findIndex(
      (m, i) => counts[i] > used[i] && xp + m.spellXp >= target && xp + m.spellXp <= MAX_XP
    )
    if (finisher >= 0) {
      used[finisher]++
      xp += MOTES[finisher].spellXp
    }
  }

  const steps: Step[] = []
  let running = cumXp(sel.from)
  for (let i = MOTES.length - 1; i >= 0; i--) {
    if (used[i] === 0) continue
    counts[i] -= used[i]
    running += used[i] * MOTES[i].spellXp
    steps.push({ kind: 'apply', mote: MOTES[i].name, count: used[i], after: stateAt(running) })
  }
  return section(sel, steps, xp, target)
}

function section(sel: Selection, steps: Step[], xp: number, target: number): SectionPlan {
  return {
    from: sel.from,
    to: sel.to,
    steps,
    reached: stateAt(xp),
    shortfallXp: Math.max(0, target - xp),
    overshootXp: Math.max(0, xp - target)
  }
}

export function planMotes(
  held: Partial<Record<MoteName, number>>,
  sel: { spell?: Selection; gear?: Selection }
): MotePlan {
  if (sel.spell) validateSelection(sel.spell, 'spell')
  if (sel.gear) validateSelection(sel.gear, 'gear')
  const counts = MOTES.map((m) => held[m.name] ?? 0)
  const gear = sel.gear ? planGear(counts, sel.gear) : undefined
  const spell = sel.spell ? planSpell(counts, sel.spell) : undefined
  const remaining = Object.fromEntries(MOTES.map((m, i) => [m.name, counts[i]])) as Record<MoteName, number>
  return { ...(spell ? { spell } : {}), ...(gear ? { gear } : {}), remaining }
}
