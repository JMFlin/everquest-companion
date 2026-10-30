// planner/moteGearSearch.ts — which motes go onto a gear piece and onto each spare copy of it.
//
// The search behind planGear in motes.ts (see ALLOCATION there): a DP over the pool, the piece
// and every copy, tier by tier, exact while it stays under KEEP states per step.

import { CONDENSE_MAX_INDEX, MAX_XP, MOTES, cumXp, mergeXp, startXp, stateAt } from './moteXp'
import type { GearSelection } from './motes'

type Op =
  | { kind: 'apply'; mote: number; count: number }
  /** Motes onto one spare copy that was at `xp` when the tier started. */
  | { kind: 'level'; mote: number; xp: number; count: number }
  | { kind: 'merge'; tier: number; count: number }

interface DpNode {
  value: number
  /** Σ count × spellXp² of the motes spent: at equal value, spend lower tiers and keep higher ones. */
  tierCost: number
  /** Spare-copy XP merged so far (the last tie-break: keep copies when motes do the same job). */
  spareXp: number
  /** The operation that led here; null at the start. */
  from: { prev: DpNode; op: Op } | null
}

/** Strictly better on (value, tier cost, spare XP), in that order. */
function cheaper(a: DpNode, b: DpNode): boolean {
  if (a.value !== b.value) return a.value < b.value
  if (a.tierCost !== b.tierCost) return a.tierCost < b.tierCost
  return a.spareXp < b.spareXp
}

type Cost = Pick<DpNode, 'value' | 'tierCost' | 'spareXp'>

function extend(node: DpNode, op: Op, cost: Cost): DpNode {
  return {
    value: node.value + cost.value,
    tierCost: node.tierCost + cost.tierCost,
    spareXp: node.spareXp + cost.spareXp,
    from: { prev: node, op }
  }
}

/** The cost of applying `count` of tier `mote`. */
function spent(mote: number, count: number): Cost {
  const { spellXp } = MOTES[mote]
  return { value: count * spellXp, tierCost: count * spellXp ** 2, spareXp: 0 }
}

/** How many motes of `itemXp` an item can still take from `xp`: none once at `stop`, never past `limit`. */
function room(xp: number, stop: number, limit: number, itemXp: number): number {
  return xp >= stop ? 0 : Math.min(Math.ceil((stop - xp) / itemXp), Math.floor((limit - xp) / itemXp))
}

/**
 * A DP state. Spare XPs are sorted at each tier's start (copies at the same XP are
 * interchangeable) and take the tier in that order. `prevStart`/`prevUsed` are the previous
 * copy's XP at the tier's start and the motes it took: a copy that starts level with the one
 * before it takes no more than it did, which drops the reorderings of the same assignment.
 */
interface Entry {
  pool: number
  piece: number
  spares: number[]
  prevStart: number
  prevUsed: number
  node: DpNode
}

/**
 * Adds `entry` to its state unless one already there has at least its pool and costs no more;
 * drops the ones it beats the same way. A bigger pool is never worse: what a tier leaves only
 * condenses, and an unused mote costs nothing.
 */
function keepBetter(layer: Map<string, Entry[]>, entry: Entry): void {
  const key = `${entry.piece}|${entry.spares.join(',')}|${entry.prevStart}|${entry.prevUsed}`
  const front = layer.get(key) ?? []
  if (front.some((e) => e.pool >= entry.pool && !cheaper(entry.node, e.node))) return
  layer.set(key, [...front.filter((e) => !(entry.pool >= e.pool && !cheaper(e.node, entry.node))), entry])
}

/**
 * States kept after each step. Every exhaustive-search test runs below it, where the DP is exact;
 * past it (many copies and a deep pool) the most promising states survive.
 */
const KEEP = 300

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
export function fewestPairs(counts: number[], used: number[]): number[] {
  const pairs: number[] = MOTES.map(() => 0)
  for (let i = MOTES.length - 1; i > 0; i--) pairs[i - 1] = Math.max(0, used[i] + 2 * pairs[i] - counts[i])
  return pairs
}

export interface GearDp {
  /** Motes applied per tier to the piece, and to each spare copy (by index into the selection's spares). */
  piece: number[]
  spare: number[][]
  /** Indices of the spare copies merged. */
  merged: number[]
}

/**
 * The DP over (pool, the piece's XP, every spare copy's XP), tier by tier, the piece then each
 * copy taking the tier in turn. A copy stays below +10, which merges for nothing; every copy may
 * merge at the end. The piece takes no mote once at the target: that only adds value and
 * overshoot. Whatever a tier leaves condenses into the next tier's pool: a condensed mote nobody
 * applies costs nothing, and planGear keeps only the condenses the applied motes need. Pools are
 * clamped to what the rest of the tier can take. Past KEEP states, keeps those that can still
 * reach the most XP, then those with the least value spent plus the least still needed.
 */
export function gearDp(counts: number[], sel: GearSelection, spares: readonly number[]): GearDp {
  const target = cumXp(sel.to)
  const bounds = usefulBounds(counts, sel.condense ?? false, 1 + spares.length)
  /**
   * [most XP still reachable (capped at the target), least value to get there] from a state in
   * tier `t` whose slots before `slot` (0 the piece, k the k-th copy) have taken it; `fresh`:
   * before tier t starts. Copies count only their whole tiers, so XP stranded part-way through
   * one ranks as spent. Later motes pour in the rest, cheapest first and fractionally, each tier
   * at most as many as are held (or condensed into it) and as fit the room the slots have now.
   */
  const promise = (t: number, slot: number, fresh: boolean, e: Entry): [number, number] => {
    let gap = target - e.piece - e.spares.reduce((n, xp) => n + mergeXp(stateAt(xp).full), 0)
    let value = e.node.value
    for (let u = t; u < MOTES.length && gap > 0; u++) {
      const m = MOTES[u]
      const capLimit = cumXp(m.itemCap + 1)
      const own =
        u > t || fresh ? bounds.held[u] + (u > 0 ? 2 * bounds.pairs[u - 1] : 0) + (u === t ? e.pool : 0) : e.pool
      const from = u > t || fresh ? 0 : slot
      let fits = from === 0 ? room(e.piece, Math.min(capLimit, target), MAX_XP, m.itemXp) : 0
      for (let k = Math.max(0, from - 1); k < e.spares.length; k++)
        fits += room(e.spares[k], capLimit, MAX_XP - 1, m.itemXp)
      const xp = Math.min(gap, Math.min(own, fits) * m.itemXp)
      value += (xp / m.itemXp) * m.spellXp
      gap -= xp
    }
    return [target - Math.max(0, gap), value]
  }
  const prune = (layer: Map<string, Entry[]>, t: number, slot: number, fresh = false): Map<string, Entry[]> => {
    const all = [...layer.values()].flat()
    if (all.length <= KEEP) return layer
    const scored = all.map((e) => ({ e, p: promise(t, slot, fresh, e) }))
    scored.sort((a, b) => b.p[0] - a.p[0] || a.p[1] - b.p[1])
    const kept = new Map<string, Entry[]>()
    for (const { e } of scored.slice(0, KEEP)) keepBetter(kept, e)
    return kept
  }

  let layer = new Map<string, Entry[]>()
  const start = { value: 0, tierCost: 0, spareXp: 0, from: null }
  const sorted = spares.map(cumXp).sort((a, b) => a - b)
  keepBetter(layer, {
    pool: 0,
    piece: startXp(sel),
    spares: sorted,
    prevStart: -1,
    prevUsed: 0,
    node: start
  })
  MOTES.forEach((mote, i) => {
    const capLimit = cumXp(mote.itemCap + 1)
    const condensing = 2 * bounds.pairs[i]
    const spareRoom = (xp: number): number => room(xp, capLimit, MAX_XP - 1, mote.itemXp)
    let next = new Map<string, Entry[]>()
    for (const e of [...layer.values()].flat()) {
      const later = e.spares.reduce((n, xp) => n + spareRoom(xp), condensing)
      const pool = e.pool + bounds.held[i]
      for (let u = 0; u <= Math.min(pool, room(e.piece, Math.min(capLimit, target), MAX_XP, mote.itemXp)); u++) {
        const op: Op = { kind: 'apply', mote: i, count: u }
        const node = u === 0 ? e.node : extend(e.node, op, spent(i, u))
        keepBetter(next, {
          ...e,
          pool: Math.min(pool - u, later),
          piece: e.piece + u * mote.itemXp,
          node
        })
      }
    }
    layer = prune(next, i, 1)
    for (let k = 0; k < spares.length; k++) {
      next = new Map()
      for (const e of [...layer.values()].flat()) {
        const xp = e.spares[k]
        const later = e.spares.slice(k + 1).reduce((n, x) => n + spareRoom(x), condensing)
        const twin = xp === e.prevStart ? e.prevUsed : Infinity
        for (let u = 0; u <= Math.min(e.pool, spareRoom(xp), twin); u++) {
          const op: Op = { kind: 'level', mote: i, xp, count: u }
          const levelled = [...e.spares]
          levelled[k] = xp + u * mote.itemXp
          const node = u === 0 ? e.node : extend(e.node, op, spent(i, u))
          keepBetter(next, {
            pool: Math.min(e.pool - u, later),
            piece: e.piece,
            spares: levelled,
            prevStart: xp,
            prevUsed: u,
            node
          })
        }
      }
      layer = prune(next, i, k + 2)
    }
    next = new Map()
    for (const e of [...layer.values()].flat()) {
      const pool = Math.min(Math.floor(e.pool / 2), bounds.pairs[i])
      keepBetter(next, {
        ...e,
        pool,
        spares: [...e.spares].sort((a, b) => a - b),
        prevStart: -1,
        prevUsed: 0
      })
    }
    layer = prune(next, i + 1, 0, true)
  })

  return assign(cheapestMerge([...layer.values()].flat(), target), spares)
}

/**
 * After Infinite (never condensed) the pool is 0. Each copy then merges in for its tier's XP or
 * stays a copy; merging any earlier would only raise the piece past caps. Returns the best end.
 */
function cheapestMerge(entries: Entry[], target: number): DpNode {
  const final = new Map<number, DpNode>()
  for (const e of entries) {
    const byTier = new Map<number, number>()
    for (const xp of e.spares) {
      const t = stateAt(xp).full
      byTier.set(t, (byTier.get(t) ?? 0) + 1)
    }
    const tiers = [...byTier]
    const visit = (g: number, piece: number, node: DpNode): void => {
      if (g === tiers.length) {
        const prev = final.get(piece)
        if (!prev || cheaper(node, prev)) final.set(piece, node)
        return
      }
      const [tier, copies] = tiers[g]
      for (let n = 0; n <= copies && piece + n * mergeXp(tier) <= MAX_XP; n++) {
        const gain = n * mergeXp(tier)
        visit(
          g + 1,
          piece + gain,
          n === 0 ? node : extend(node, { kind: 'merge', tier, count: n }, { value: 0, tierCost: 0, spareXp: gain })
        )
      }
    }
    visit(0, e.piece, e.node)
  }
  return [...final].reduce((a, b) => {
    const better =
      Math.min(b[0], target) - Math.min(a[0], target) ||
      a[1].value - b[1].value ||
      Math.max(0, a[0] - target) - Math.max(0, b[0] - target) ||
      a[1].tierCost - b[1].tierCost ||
      a[1].spareXp - b[1].spareXp
    return better > 0 ? b : a
  })[1]
}

/** The per-copy plan the DP's path from the start to `best` describes. */
function assign(best: DpNode, spares: readonly number[]): GearDp {
  const ops: Op[] = []
  for (let n = best; n.from; n = n.from.prev) ops.unshift(n.from.op)
  // Replay to hand each levelling to a concrete copy: one at that XP when the tier started and not
  // yet given this tier. Merges take the levelled copies of a tier first.
  const dp: GearDp = {
    piece: MOTES.map(() => 0),
    spare: spares.map(() => MOTES.map(() => 0)),
    merged: []
  }
  const xp = spares.map(cumXp)
  let tier = -1
  let tierStart: number[] = []
  const given = new Set<number>()
  for (const op of ops) {
    if (op.kind === 'merge') {
      const levelled = (j: number): boolean => dp.spare[j].some((n) => n > 0)
      const pick = spares
        .map((_, j) => j)
        .filter((j) => stateAt(xp[j]).full === op.tier && !dp.merged.includes(j))
        .sort((a, b) => Number(levelled(b)) - Number(levelled(a)) || a - b)
      dp.merged.push(...pick.slice(0, op.count))
      continue
    }
    if (op.mote !== tier) {
      tier = op.mote
      tierStart = [...xp]
      given.clear()
    }
    if (op.kind === 'apply') {
      dp.piece[op.mote] = op.count
      continue
    }
    const j = spares.findIndex((_, c) => tierStart[c] === op.xp && !given.has(c))
    given.add(j)
    dp.spare[j][op.mote] = op.count
    xp[j] += op.count * MOTES[op.mote].itemXp
  }
  return dp
}
