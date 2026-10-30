// MOTE PLANNER FIXTURE — the independent game-rule simulator and exhaustive search that
// tests/motePlanner.test.mts checks every plan against (see that file's header).

import assert from 'node:assert/strict'
import { MOTES, type MoteName, type SectionPlan, type Step } from '../src/shared/planner/motes'

export const MAX_XP = 1023
export const NAMES = MOTES.map((m) => m.name)
export const idx = (name: MoteName): number => NAMES.indexOf(name)
export const cum = (rank: number): number => 2 ** rank - 1
const tierOf = (xp: number): number => Math.floor(Math.log2(xp + 1))
const stateOf = (xp: number): { full: number; fraction: number } => {
  const full = Math.min(10, tierOf(xp))
  return { full, fraction: xp - cum(full) }
}
export const spellValue = (counts: number[]): number => counts.reduce((s, c, i) => s + c * MOTES[i].spellXp, 0)
export const toCounts = (held: Partial<Record<MoteName, number>>): number[] => NAMES.map((n) => held[n] ?? 0)

export const OWNER: Partial<Record<MoteName, number>> = {
  'Mote of Infinitesimal Potential': 21,
  'Mote of Minor Potential': 29,
  'Mote of Lesser Potential': 1,
  'Mote of Potential': 10,
  'Mote of Major Potential': 6,
  'Mote of Greater Potential': 12,
  'Mote of Superior Potential': 1,
  'Mote of Grand Potential': 1,
  'Mote of Infinite Potential': 1
}

/** Executes a spare-levelling step against `counts` and `spareXp` (both mutated); returns value spent. */
function replayLevel(
  counts: number[],
  spareXp: number[],
  step: Extract<Step, { kind: 'level' }>,
  origin: number
): number {
  assert.equal(step.from, origin)
  const i = idx(step.mote)
  for (let n = 0; n < step.count; n++) {
    assert.ok(counts[i] > 0, `level ${step.mote} overdraws`)
    assert.ok(tierOf(spareXp[step.spare]) <= MOTES[i].itemCap, `${step.mote} applied to a spare above cap`)
    counts[i]--
    spareXp[step.spare] += MOTES[i].itemXp
    assert.ok(tierOf(spareXp[step.spare]) <= 9, 'spare levelled to +10')
  }
  assert.deepEqual(step.after, stateOf(spareXp[step.spare]))
  return step.count * MOTES[i].spellXp
}

/** Executes a section's steps against `counts` (mutated); returns final XP and value spent. */
export function replay(
  counts: number[],
  plan: SectionPlan,
  kind: 'gear' | 'spell',
  opts: { fraction?: number; spares?: number[]; condense?: boolean } = {}
): { xp: number; value: number } {
  let xp = cum(plan.from) + (opts.fraction ?? 0)
  let value = 0
  const spares = [...(opts.spares ?? [])]
  const origin = [...spares]
  const spareXp = spares.map(cum)
  for (const step of plan.steps) {
    if (step.kind === 'level') {
      value += replayLevel(counts, spareXp, step, origin[step.spare])
      spares[step.spare] = tierOf(spareXp[step.spare])
      continue
    }
    if (step.kind === 'merge') {
      assert.equal(kind, 'gear', 'spells never merge')
      for (let n = 0; n < step.count; n++) {
        const at = spares.indexOf(step.tier)
        assert.ok(at >= 0, `merge +${step.tier} overdraws the spare copies`)
        spares.splice(at, 1)
        xp += 2 ** step.tier
        assert.ok(xp <= MAX_XP, 'XP past 1023')
      }
      assert.deepEqual(step.after, stateOf(xp))
      continue
    }
    const i = idx(step.mote)
    if (step.kind === 'condense') {
      assert.equal(kind, 'gear', 'spells never condense')
      assert.ok(opts.condense, 'condensed without opting in')
      assert.ok(i + 1 <= idx('Mote of Ascendant Potential'), 'cannot condense into Infinite')
      assert.equal(step.into, NAMES[i + 1])
      counts[i] -= 2 * step.pairs
      assert.ok(counts[i] >= 0, `condense ${step.mote} overdraws`)
      counts[i + 1] += step.pairs
      continue
    }
    for (let n = 0; n < step.count; n++) {
      assert.ok(counts[i] > 0, `apply ${step.mote} overdraws`)
      if (kind === 'gear') assert.ok(tierOf(xp) <= MOTES[i].itemCap, `${step.mote} applied above cap`)
      counts[i]--
      xp += kind === 'gear' ? MOTES[i].itemXp : MOTES[i].spellXp
      value += MOTES[i].spellXp
      assert.ok(xp <= MAX_XP, 'XP past 1023')
    }
    assert.deepEqual(step.after, stateOf(xp))
  }
  const target = cum(plan.to)
  assert.deepEqual(plan.reached, stateOf(xp))
  assert.equal(plan.shortfallXp, Math.max(0, target - xp))
  assert.equal(plan.overshootXp, Math.max(0, xp - target))
  return { xp, value }
}

export const lexGreater = (a: number[], b: number[]): boolean => {
  const d = a.findIndex((v, i) => v !== b[i])
  return d >= 0 && a[d] > b[d]
}

/** Best (reachedKey, -value, -overshoot) over every valid operation sequence, merges anywhere. */
export function bruteForceGear(
  counts: number[],
  from: number,
  to: number,
  opts: {
    fraction?: number
    spares?: number[]
    condense?: boolean
    level?: boolean
  } = {}
): [number, number, number] {
  const target = cum(to)
  let best: [number, number, number] = [-1, 0, 0]
  const seen = new Set<string>()
  const visit = (c: number[], xp: number, value: number, sp: number[]): void => {
    const key = `${c.join(',')}|${xp}|${sp.join(',')}`
    if (seen.has(key)) return
    seen.add(key)
    const score: [number, number, number] = [Math.min(xp, target), -value, -Math.max(0, xp - target)]
    if (lexGreater(score, best)) best = score
    sp.forEach((s, j) => {
      if (xp + 2 ** tierOf(s) <= MAX_XP)
        visit(
          c,
          xp + 2 ** tierOf(s),
          value,
          sp.filter((_, k) => k !== j)
        )
    })
    for (let i = 0; i < c.length; i++) {
      if (c[i] === 0) continue
      sp.forEach((s, j) => {
        if (!opts.level || tierOf(s) > MOTES[i].itemCap || tierOf(s + MOTES[i].itemXp) > 9) return
        const n = [...c]
        n[i]--
        visit(
          n,
          xp,
          value + MOTES[i].spellXp,
          sp.map((v, k) => (k === j ? v + MOTES[i].itemXp : v)).sort((a, b) => a - b)
        )
      })
      if (tierOf(xp) <= MOTES[i].itemCap && xp + MOTES[i].itemXp <= MAX_XP) {
        const n = [...c]
        n[i]--
        visit(n, xp + MOTES[i].itemXp, value + MOTES[i].spellXp, sp)
      }
      if (opts.condense && c[i] >= 2 && i + 1 <= idx('Mote of Ascendant Potential')) {
        const n = [...c]
        n[i] -= 2
        n[i + 1]++
        visit(n, xp, value, sp)
      }
    }
  }
  visit(
    counts,
    cum(from) + (opts.fraction ?? 0),
    0,
    (opts.spares ?? []).map(cum).sort((a, b) => a - b)
  )
  return best
}
