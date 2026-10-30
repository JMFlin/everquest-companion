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
// - Gear merge: a spare copy of the same item at tier t merges in for 2^t XP (eqlwiki
//   Item_Upgrade_System, Gear Merge Experience: +0 -> 1 ... +9 -> 512), with no tier cap.
// - Condense: 2 motes of tier n -> 1 of tier n+1, producing at most Ascendant. Spell value is
//   conserved by condensing (spellXp doubles per tier); gear XP is lost or kept, never gained —
//   condensing only ever helps gear by raising the cap. Off unless the gear selection opts in.
//
// ALLOCATION (one shared pool)
// 1. Gear first (`moteGearSearch.ts`). DP over (pool, the piece's XP, every spare copy's XP) tier
//    by tier, applying in ascending itemCap order on each item — a lower-cap mote is only harder
//    to place later, so this order never strands a mote another order could use. Spare copies
//    take motes before they merge (they open the low-cap windows again), then merge at the end,
//    where they have no cap to pass. Lexicographic objective: reach `to` (else most XP), then
//    least spell value consumed, then least overshoot, then lower tiers spent (Σ spellXp²), then
//    fewest condenses, then least spare-copy XP merged. Counts are first clamped to what can ever
//    be used (`usefulBounds`). Exact while each step stays under KEEP states; with many copies
//    past that it keeps the states closest to the goal for the least value.
// 2. Spell takes what remains: largest-first greedy within the need (powers of two, so the fill is
//    exact whenever exact is possible), then the smallest single mote that completes the goal
//    without passing 1023. Never condenses (neutral for spells).

import type { ItemUpgradeState } from '../itemUpgrade'
import { ITEM_MAX_TIER, expToNextTier } from '../itemStats'
import { fewestPairs, gearDp } from './moteGearSearch'
import { MAX_XP, MOTES, SPARE_MAX_TIER, cumXp, mergeXp, startXp, stateAt, type MoteName } from './moteXp'

export { MOTES, SPARE_MAX_TIER, mergeXp, type MoteName } from './moteXp'

export interface Selection {
  from: number
  to: number
  /** XP already banked toward `from + 1` (the in-game "x / y" x), 0 <= fraction < 2^from. */
  fraction?: number
}

/** The gear section's selection, plus the tiers of spare copies of the same item to merge. */
export interface GearSelection extends Selection {
  spares?: number[]
  /** Whether the plan may condense motes to unlock higher caps (default off). */
  condense?: boolean
}

export type Step =
  | { kind: 'condense'; mote: MoteName; pairs: number; into: MoteName }
  | { kind: 'apply'; mote: MoteName; count: number; after: ItemUpgradeState }
  /** Motes onto spare copy `spare` (index into the gear selection's spares, at tier `from`) before it merges. */
  | {
      kind: 'level'
      spare: number
      from: number
      mote: MoteName
      count: number
      after: ItemUpgradeState
    }
  | { kind: 'merge'; tier: number; count: number; after: ItemUpgradeState }

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

function validateSelection(sel: Selection, label: string): void {
  const { from, to } = sel
  if (!Number.isInteger(from) || from < 0 || from > ITEM_MAX_TIER - 1) {
    throw new Error(`${label}.from must be an integer 0..${ITEM_MAX_TIER - 1}, got ${from}`)
  }
  if (!Number.isInteger(to) || to <= from || to > ITEM_MAX_TIER) {
    throw new Error(`${label}.to must be an integer ${from + 1}..${ITEM_MAX_TIER}, got ${to}`)
  }
  const fraction = sel.fraction ?? 0
  const step = expToNextTier(from) ?? 0
  if (!Number.isInteger(fraction) || fraction < 0 || fraction >= step) {
    throw new Error(`${label}.fraction must be an integer 0..${step - 1}, got ${fraction}`)
  }
}

function validateSpares(spares: readonly number[]): void {
  for (const t of spares) {
    if (!Number.isInteger(t) || t < 0 || t > SPARE_MAX_TIER) {
      throw new Error(`gear.spares tiers must be integers 0..${SPARE_MAX_TIER}, got ${t}`)
    }
  }
}

/** Applies `used` per tier out of `counts` (mutated), after the fewest condenses that cover it. */
function spend(steps: Step[], counts: number[], used: number[]): void {
  const pairs = fewestPairs(counts, used)
  MOTES.forEach((mote, i) => {
    if (pairs[i] > 0)
      steps.push({
        kind: 'condense',
        mote: mote.name,
        pairs: pairs[i],
        into: MOTES[i + 1].name
      })
    counts[i] += (i > 0 ? pairs[i - 1] : 0) - 2 * pairs[i] - used[i]
  })
}

/** Spare `j`'s levelling steps from tier `from`; returns the tier it reaches. */
function levelSteps(steps: Step[], j: number, from: number, used: number[]): number {
  let xp = cumXp(from)
  MOTES.forEach((mote, i) => {
    if (used[i] === 0) return
    xp += used[i] * mote.itemXp
    steps.push({
      kind: 'level',
      spare: j,
      from,
      mote: mote.name,
      count: used[i],
      after: stateAt(xp)
    })
  })
  return stateAt(xp).full
}

/** Gear plan over `counts` (mutated to what remains). */
function planGear(counts: number[], sel: GearSelection): SectionPlan {
  const spares = sel.spares ?? []
  const dp = gearDp(counts, sel, spares)
  const steps: Step[] = []
  spend(
    steps,
    counts,
    MOTES.map((_, i) => dp.spare.reduce((n, used) => n + used[i], dp.piece[i]))
  )
  const tiers = spares.map((t, j) => levelSteps(steps, j, t, dp.spare[j]))
  let xp = startXp(sel)
  MOTES.forEach((mote, i) => {
    if (dp.piece[i] === 0) return
    xp += dp.piece[i] * mote.itemXp
    steps.push({
      kind: 'apply',
      mote: mote.name,
      count: dp.piece[i],
      after: stateAt(xp)
    })
  })
  const gains = dp.merged.map((j) => mergeXp(tiers[j]))
  for (const gain of [...new Set(gains)].sort((a, b) => a - b)) {
    const count = gains.filter((g) => g === gain).length
    xp += count * gain
    steps.push({
      kind: 'merge',
      tier: Math.log2(gain),
      count,
      after: stateAt(xp)
    })
  }
  return section(sel, steps, xp, cumXp(sel.to))
}

/** Spell plan over `counts` (mutated to what remains). */
function planSpell(counts: number[], sel: Selection): SectionPlan {
  const target = cumXp(sel.to)
  let xp = startXp(sel)
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

  // Listed smallest first, like gear's (whose order the tier caps force); a spell's order is free.
  const steps: Step[] = []
  let running = startXp(sel)
  for (let i = 0; i < MOTES.length; i++) {
    if (used[i] === 0) continue
    counts[i] -= used[i]
    running += used[i] * MOTES[i].spellXp
    steps.push({
      kind: 'apply',
      mote: MOTES[i].name,
      count: used[i],
      after: stateAt(running)
    })
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
  sel: { spell?: Selection; gear?: GearSelection }
): MotePlan {
  if (sel.spell) validateSelection(sel.spell, 'spell')
  if (sel.gear) {
    validateSelection(sel.gear, 'gear')
    validateSpares(sel.gear.spares ?? [])
  }
  const counts = MOTES.map((m) => held[m.name] ?? 0)
  const gear = sel.gear ? planGear(counts, sel.gear) : undefined
  const spell = sel.spell ? planSpell(counts, sel.spell) : undefined
  const remaining = Object.fromEntries(MOTES.map((m, i) => [m.name, counts[i]])) as Record<MoteName, number>
  return { ...(spell ? { spell } : {}), ...(gear ? { gear } : {}), remaining }
}
