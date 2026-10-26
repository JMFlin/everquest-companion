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
// 1. Gear first. Exact DP over (pool, the piece's XP, one levelling spare's XP) tier by tier,
//    applying in ascending itemCap order on each item — a lower-cap mote is only harder to place
//    later, so this order never strands a mote another order could use. A spare copy may take
//    motes before it merges (it opens the low-cap windows again), then every spare merges at the
//    end, where it has no cap to pass. Lexicographic objective: reach `to` (else most XP), then
//    least spell value consumed, then least overshoot, then fewest condenses, then least
//    spare-copy XP merged. Counts are first clamped to what can ever be used (`usefulBounds`).
//    The state grows with every levelling spare, so spares level one at a time (`planGear`).
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
  /** XP already banked toward `from + 1` (the in-game "x / y" x), 0 <= fraction < 2^from. */
  fraction?: number
}

/** The gear section's selection, plus the tiers of spare copies of the same item to merge. */
export interface GearSelection extends Selection {
  spares?: number[]
  /** Whether the plan may condense motes to unlock higher caps (default off). */
  condense?: boolean
}

/** XP a spare copy at `tier` merges in for. */
export function mergeXp(tier: number): number {
  return 2 ** tier
}

/** Highest tier a spare copy can be for merging (the wiki lists no merge XP for +10). */
export const SPARE_MAX_TIER = ITEM_MAX_TIER - 1

export type Step =
  | { kind: 'condense'; mote: MoteName; pairs: number; into: MoteName }
  | { kind: 'apply'; mote: MoteName; count: number; after: ItemUpgradeState }
  /** Motes onto spare copy `spare` (index into the gear selection's spares, at tier `from`) before it merges. */
  | { kind: 'level'; spare: number; from: number; mote: MoteName; count: number; after: ItemUpgradeState }
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

/** Cumulative XP of a selection's starting state. */
function startXp(sel: Selection): number {
  return cumXp(sel.from) + (sel.fraction ?? 0)
}

type Op = { kind: 'apply'; mote: number; item: number; count: number } | { kind: 'merge'; xp: number }

interface DpNode {
  value: number
  /** Spare-copy XP merged so far (the last tie-break: keep copies when motes do the same job). */
  spareXp: number
  /** The operation that led here; null at the start. */
  from: { prev: DpNode; op: Op } | null
}

/** Strictly better on (value, spare XP), in that order. */
function cheaper(a: DpNode, b: DpNode): boolean {
  if (a.value !== b.value) return a.value < b.value
  return a.spareXp < b.spareXp
}

/** Keeps the cheaper of two ways into the same DP state. */
function keepBetter(layer: Map<number, DpNode>, key: number, cand: DpNode): void {
  const prev = layer.get(key)
  if (prev && !cheaper(cand, prev)) return
  layer.set(key, cand)
}

function extend(node: DpNode, op: Op, value: number, spareXp: number): DpNode {
  return { value: node.value + value, spareXp: node.spareXp + spareXp, from: { prev: node, op } }
}

/**
 * Per tier: how many held motes can ever be used, and how many pairs into the next tier can.
 * One item applies a tier at most min(ceil(capLimit / itemXp), floor(1023 / itemXp)) times (XP
 * only grows, from 0 at best), so `items` of them at most that many times over. An optimum
 * spends held motes before condensed ones, so tier n+1 draws at most max(0, useful(n+1) -
 * held(n+1)) pairs from tier n. Clamping to these bounds changes no optimum.
 */
function usefulBounds(counts: number[], condense: boolean, items: number): { held: number[]; pairs: number[] } {
  const useful: number[] = MOTES.map(() => 0)
  const pairs: number[] = MOTES.map(() => 0)
  for (let i = MOTES.length - 1; i >= 0; i--) {
    const m = MOTES[i]
    const applications = items * Math.min(Math.ceil(cumXp(m.itemCap + 1) / m.itemXp), Math.floor(MAX_XP / m.itemXp))
    pairs[i] = condense && i < CONDENSE_MAX_INDEX ? Math.max(0, useful[i + 1] - counts[i + 1]) : 0
    useful[i] = applications + 2 * pairs[i]
  }
  return { held: counts.map((c, i) => Math.min(c, useful[i])), pairs }
}

/** The fewest condenses that cover applying `used` per tier out of `counts`, from the top tier down. */
function fewestPairs(counts: number[], used: number[]): number[] {
  const pairs: number[] = MOTES.map(() => 0)
  for (let i = MOTES.length - 1; i > 0; i--) pairs[i - 1] = Math.max(0, used[i] + 2 * pairs[i] - counts[i])
  return pairs
}

interface GearDp {
  /** Motes applied per tier to the piece and to the levelled spare. */
  piece: number[]
  spare: number[]
  /** Merge XP of each spare merged. */
  merged: number[]
}

// DP keys pack (pool, piece XP, levelled spare XP); both XPs stay within 0..1023.
const XP_SPAN = MAX_XP + 1
const pack = (pool: number, piece: number, spare: number): number => (pool * XP_SPAN + piece) * XP_SPAN + spare
const unpack = (key: number): [number, number, number] => [
  Math.floor(key / XP_SPAN / XP_SPAN),
  Math.floor(key / XP_SPAN) % XP_SPAN,
  key % XP_SPAN
]

interface DpItem {
  /** Index into the packed XPs: 0 the piece, 1 the levelled spare. */
  item: 0 | 1
  /** Highest XP the item may reach. */
  limit: number
  /** No application starts at or past this XP. */
  below: number
}

/** How many of `mote` (cap limit `capLimit`) the item can still take from `xp`. */
function room(it: DpItem, xp: number, itemXp: number, capLimit: number): number {
  const stop = Math.min(capLimit, it.below)
  return xp >= stop ? 0 : Math.min(Math.ceil((stop - xp) / itemXp), Math.floor((it.limit - xp) / itemXp))
}

/**
 * The exact DP over (pool, the piece's XP, the levelled spare's XP), tier by tier. Spare `level`
 * (if any) takes motes alongside the piece and stays below +10, which merges for nothing; the
 * other spares sit at their tiers. Every spare may merge at the end. The piece takes no mote once
 * at the target: that only adds value and overshoot. Whatever a tier leaves condenses into the
 * next tier's pool: a condensed mote nobody applies costs nothing, and planGear keeps only the
 * condenses the applied motes need. Pools are clamped to what the rest of the tier can take.
 */
function gearDp(counts: number[], sel: GearSelection, spares: number[], level: number | null): GearDp {
  const target = cumXp(sel.to)
  const bounds = usefulBounds(counts, sel.condense ?? false, level === null ? 1 : 2)
  const items: DpItem[] = [
    { item: 0, limit: MAX_XP, below: target },
    ...(level === null ? [] : [{ item: 1 as const, limit: MAX_XP - 1, below: MAX_XP }])
  ]

  let layer = new Map<number, DpNode>([
    [pack(0, startXp(sel), level === null ? 0 : cumXp(spares[level])), { value: 0, spareXp: 0, from: null }]
  ])
  MOTES.forEach((mote, i) => {
    const capLimit = cumXp(mote.itemCap + 1)
    const condensing = 2 * bounds.pairs[i]
    let next = new Map<number, DpNode>()
    for (const [key, node] of layer) next.set(key + pack(bounds.held[i], 0, 0), node)
    layer = next
    // Each item takes this tier in turn, from the one shared pool.
    items.forEach((it, n) => {
      next = new Map()
      for (const [key, node] of layer) {
        const [held, ...xs] = unpack(key)
        const xp = xs[it.item]
        const later = items.slice(n + 1).reduce((s, o) => s + room(o, xs[o.item], mote.itemXp, capLimit), condensing)
        const most = Math.min(held, room(it, xp, mote.itemXp, capLimit))
        for (let u = 0; u <= most; u++) {
          const pool = Math.min(held - u, later)
          const after = it.item === 0 ? pack(pool, xp + u * mote.itemXp, xs[1]) : pack(pool, xs[0], xp + u * mote.itemXp)
          const op: Op = { kind: 'apply', mote: i, item: it.item, count: u }
          keepBetter(next, after, u === 0 ? node : extend(node, op, u * mote.spellXp, 0))
        }
      }
      layer = next
    })
    next = new Map()
    for (const [key, node] of layer) {
      const [pool, piece, spare] = unpack(key)
      keepBetter(next, pack(Math.min(Math.floor(pool / 2), bounds.pairs[i]), piece, spare), node)
    }
    layer = next
  })

  // After Infinite (never condensed) the pool is 0. Each spare then merges in for its tier's XP or
  // stays a copy; merging any earlier would only raise the piece past caps. From here keys are the
  // piece's XP alone.
  let merged = new Map<number, DpNode>()
  for (const [key, node] of layer) {
    const [, piece, spare] = unpack(key)
    keepBetter(merged, piece, node)
    const gain = level === null ? 0 : mergeXp(stateAt(spare).full)
    if (gain > 0 && piece + gain <= MAX_XP) keepBetter(merged, piece + gain, extend(node, { kind: 'merge', xp: gain }, 0, gain))
  }
  spares.forEach((tier, j) => {
    if (j === level) return
    const next = new Map<number, DpNode>()
    for (const [piece, node] of merged) {
      keepBetter(next, piece, node)
      const gain = mergeXp(tier)
      if (piece + gain <= MAX_XP) keepBetter(next, piece + gain, extend(node, { kind: 'merge', xp: gain }, 0, gain))
    }
    merged = next
  })
  const [, best] = [...merged].reduce((a, b) => {
    const better =
      Math.min(b[0], target) - Math.min(a[0], target) ||
      a[1].value - b[1].value ||
      Math.max(0, a[0] - target) - Math.max(0, b[0] - target) ||
      a[1].spareXp - b[1].spareXp
    return better > 0 ? b : a
  })

  const dp: GearDp = { piece: MOTES.map(() => 0), spare: MOTES.map(() => 0), merged: [] }
  for (let n = best; n.from; n = n.from.prev) {
    const op = n.from.op
    if (op.kind === 'apply') (op.item === 0 ? dp.piece : dp.spare)[op.mote] = op.count
    else dp.merged.push(op.xp)
  }
  return dp
}

/** Applies `used` per tier out of `counts` (mutated), after the fewest condenses that cover it. */
function spend(steps: Step[], counts: number[], used: number[]): void {
  const pairs = fewestPairs(counts, used)
  MOTES.forEach((mote, i) => {
    if (pairs[i] > 0) steps.push({ kind: 'condense', mote: mote.name, pairs: pairs[i], into: MOTES[i + 1].name })
    counts[i] += (i > 0 ? pairs[i - 1] : 0) - 2 * pairs[i] - used[i]
  })
}

/** Spare `j`'s levelling steps from tier `from`; returns the tier it reaches. */
function levelSteps(steps: Step[], j: number, from: number, used: number[]): number {
  let xp = cumXp(from)
  MOTES.forEach((mote, i) => {
    if (used[i] === 0) return
    xp += used[i] * mote.itemXp
    steps.push({ kind: 'level', spare: j, from, mote: mote.name, count: used[i], after: stateAt(xp) })
  })
  return stateAt(xp).full
}

/**
 * Gear plan over `counts` (mutated to what remains). The DP's state grows with every spare it
 * levels, so spares are levelled one at a time, lowest tier first (the most low-cap windows):
 * each round is the exact DP with that one spare levelling, and keeps only its levelling (plus the
 * condenses it needs); the last round's whole plan stands. Exact with at most one spare.
 */
function planGear(counts: number[], sel: GearSelection): SectionPlan {
  const tiers = [...(sel.spares ?? [])]
  const order = tiers.map((_, j) => j).sort((a, b) => tiers[a] - tiers[b])
  const last = order.length > 0 ? order[order.length - 1] : null
  const steps: Step[] = []
  for (const j of order.slice(0, -1)) {
    const used = gearDp(counts, sel, tiers, j).spare
    spend(steps, counts, used)
    tiers[j] = levelSteps(steps, j, tiers[j], used)
  }

  const dp = gearDp(counts, sel, tiers, last)
  spend(steps, counts, dp.piece.map((n, i) => n + dp.spare[i]))
  if (last !== null) levelSteps(steps, last, tiers[last], dp.spare)
  let xp = startXp(sel)
  MOTES.forEach((mote, i) => {
    if (dp.piece[i] === 0) return
    xp += dp.piece[i] * mote.itemXp
    steps.push({ kind: 'apply', mote: mote.name, count: dp.piece[i], after: stateAt(xp) })
  })
  for (const gain of [...new Set(dp.merged)].sort((a, b) => a - b)) {
    const count = dp.merged.filter((g) => g === gain).length
    xp += count * gain
    steps.push({ kind: 'merge', tier: Math.log2(gain), count, after: stateAt(xp) })
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
