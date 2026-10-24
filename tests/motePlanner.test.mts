// MOTE PLANNER TEST — src/shared/planner/motes.ts.
//
// Every plan is REPLAYED through an independent simulator of the game rules (condense pairs,
// gear cap per application, the 1023 ceiling), so a plan that reads right but cannot be executed
// fails here. Gear optimality is cross-checked against exhaustive search over every valid
// operation sequence (any order, any interleaving of condense and apply) on small random pools.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MOTES, planMotes, type MoteName, type SectionPlan } from '../src/shared/planner/motes'

const MAX_XP = 1023
const NAMES = MOTES.map((m) => m.name)
const idx = (name: MoteName): number => NAMES.indexOf(name)
const cum = (rank: number): number => 2 ** rank - 1
const tierOf = (xp: number): number => Math.floor(Math.log2(xp + 1))
const stateOf = (xp: number): { full: number; fraction: number } => {
  const full = Math.min(10, tierOf(xp))
  return { full, fraction: xp - cum(full) }
}
const spellValue = (counts: number[]): number => counts.reduce((s, c, i) => s + c * MOTES[i].spellXp, 0)
const toCounts = (held: Partial<Record<MoteName, number>>): number[] => NAMES.map((n) => held[n] ?? 0)

const OWNER: Partial<Record<MoteName, number>> = {
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

/** Executes a section's steps against `counts` (mutated); returns final XP and value spent. */
function replay(
  counts: number[],
  plan: SectionPlan,
  kind: 'gear' | 'spell',
  opts: { fraction?: number; spares?: number[] } = {}
): { xp: number; value: number } {
  let xp = cum(plan.from) + (opts.fraction ?? 0)
  let value = 0
  const spares = [...(opts.spares ?? [])]
  for (const step of plan.steps) {
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

test("owner's inventory: spell 0->10 is an exact 1023 fill", () => {
  const plan = planMotes(OWNER, { spell: { from: 0, to: 10 } })
  const spell = plan.spell as SectionPlan
  assert.deepEqual(spell.reached, { full: 10, fraction: 0 })
  assert.equal(spell.overshootXp, 0)
  assert.equal(spell.shortfallXp, 0)
  const used = Object.fromEntries(spell.steps.map((s) => [s.mote, s.kind === 'apply' ? s.count : 0]))
  assert.deepEqual(used, {
    'Mote of Infinite Potential': 1,
    'Mote of Grand Potential': 1,
    'Mote of Superior Potential': 1,
    'Mote of Greater Potential': 9,
    'Mote of Major Potential': 1,
    'Mote of Potential': 1,
    'Mote of Lesser Potential': 1,
    'Mote of Minor Potential': 1,
    'Mote of Infinitesimal Potential': 1
  })
  assert.equal(spellValue(toCounts(plan.remaining)), 324)
  replay(toCounts(OWNER), spell, 'spell')
})

test('spell beyond the pool reports the shortfall and where it got to', () => {
  const plan = planMotes({ 'Mote of Major Potential': 1 }, { spell: { from: 0, to: 10 } })
  const spell = plan.spell as SectionPlan
  assert.deepEqual(spell.reached, { full: 4, fraction: 1 })
  assert.equal(spell.shortfallXp, 1007)
  assert.equal(spell.overshootXp, 0)
})

test('spell finishes with the smallest single overshooting mote', () => {
  const held = { 'Mote of Greater Potential': 1, 'Mote of Grand Potential': 1 }
  const spell = planMotes(held, { spell: { from: 0, to: 3 } }).spell as SectionPlan
  assert.deepEqual(spell.steps, [
    { kind: 'apply', mote: 'Mote of Greater Potential', count: 1, after: { full: 5, fraction: 1 } }
  ])
  assert.equal(spell.overshootXp, 25)
})

test('spell never passes 1023, even to finish', () => {
  const held = { 'Mote of Infinite Potential': 2, 'Mote of Grand Potential': 1 }
  const plan = planMotes(held, { spell: { from: 8, to: 10 } })
  const spell = plan.spell as SectionPlan
  assert.deepEqual(spell.reached, { full: 9, fraction: 384 })
  assert.equal(spell.shortfallXp, 128)
  assert.equal(plan.remaining['Mote of Infinite Potential'], 1)
})

test('gear prefers the cheaper path that still reaches the goal', () => {
  const held = { 'Mote of Infinitesimal Potential': 3, 'Mote of Potential': 2 }
  const gear = planMotes(held, { gear: { from: 0, to: 3 } }).gear as SectionPlan
  assert.deepEqual(gear.steps, [
    { kind: 'apply', mote: 'Mote of Potential', count: 2, after: { full: 3, fraction: 1 } }
  ])
  assert.equal(gear.overshootXp, 1)
  replay(toCounts(held), gear, 'gear')
})

test('gear applies in ascending cap order (Infinitesimal only fits at tier 0)', () => {
  const held = { 'Mote of Infinitesimal Potential': 1, 'Mote of Potential': 1 }
  const gear = planMotes(held, { gear: { from: 0, to: 3 } }).gear as SectionPlan
  assert.deepEqual(gear.steps, [
    { kind: 'apply', mote: 'Mote of Infinitesimal Potential', count: 1, after: { full: 1, fraction: 0 } },
    { kind: 'apply', mote: 'Mote of Potential', count: 1, after: { full: 2, fraction: 2 } }
  ])
  assert.equal(gear.shortfallXp, 2)
})

test('gear condenses to unlock a higher cap', () => {
  const held = { 'Mote of Potential': 4 }
  const plan = planMotes(held, { gear: { from: 3, to: 5 } })
  const gear = plan.gear as SectionPlan
  assert.deepEqual(gear.steps, [
    { kind: 'condense', mote: 'Mote of Potential', pairs: 1, into: 'Mote of Major Potential' },
    { kind: 'apply', mote: 'Mote of Potential', count: 2, after: { full: 4, fraction: 0 } },
    { kind: 'apply', mote: 'Mote of Major Potential', count: 1, after: { full: 4, fraction: 5 } }
  ])
  assert.equal(gear.shortfallXp, 11)
  assert.equal(plan.remaining['Mote of Potential'], 0)
  replay(toCounts(held), gear, 'gear')
})

test('gear never passes 1023', () => {
  const gear = planMotes({ 'Mote of Infinite Potential': 60 }, { gear: { from: 9, to: 10 } }).gear as SectionPlan
  assert.deepEqual(gear.reached, { full: 9, fraction: 510 })
  assert.equal(gear.shortfallXp, 2)
})

test('shared pool: gear then spell never double-books', () => {
  const plan = planMotes(OWNER, { gear: { from: 0, to: 7 }, spell: { from: 0, to: 10 } })
  const counts = toCounts(OWNER)
  const gear = replay(counts, plan.gear as SectionPlan, 'gear')
  const spell = replay(counts, plan.spell as SectionPlan, 'spell')
  assert.deepEqual(counts, toCounts(plan.remaining))
  assert.equal(gear.value + spell.value + spellValue(counts), spellValue(toCounts(OWNER)))
  assert.equal((plan.gear as SectionPlan).shortfallXp, 0)
})

test('selection ranges are validated', () => {
  assert.throws(() => planMotes({}, { spell: { from: 10, to: 10 } }))
  assert.throws(() => planMotes({}, { gear: { from: 3, to: 3 } }))
  assert.throws(() => planMotes({}, { gear: { from: 0, to: 11 } }))
  assert.throws(() => planMotes({}, { spell: { from: 1.5, to: 3 } }))
})

const lexGreater = (a: number[], b: number[]): boolean => {
  const d = a.findIndex((v, i) => v !== b[i])
  return d >= 0 && a[d] > b[d]
}

test('hoards stay fast and plan as the clamped pool does', () => {
  // With every tier held past its own application limit nothing is worth condensing, so the
  // clamped pool is exactly each tier's application limit (cap window and 1023 horizon).
  const limit = MOTES.map((m) => Math.min(Math.ceil((2 ** (m.itemCap + 1) - 1) / m.itemXp), Math.floor(MAX_XP / m.itemXp)))
  const clamped = planMotes(Object.fromEntries(NAMES.map((n, i) => [n, limit[i]])), { gear: { from: 0, to: 10 } })
  for (const each of [300, 1000]) {
    const held = Object.fromEntries(NAMES.map((n) => [n, each]))
    const t0 = performance.now()
    const plan = planMotes(held, { gear: { from: 0, to: 10 } })
    const ms = performance.now() - t0
    assert.ok(ms < 300, `${each}-each took ${ms.toFixed(0)} ms`)
    assert.deepEqual(plan.gear, clamped.gear)
    replay(toCounts(held), plan.gear as SectionPlan, 'gear')
  }
})

test('a hoard of the lowest tiers (the worst case: everything condenses) stays bounded', () => {
  const held = { 'Mote of Infinitesimal Potential': 1000, 'Mote of Minor Potential': 1000 }
  const t0 = performance.now()
  const plan = planMotes(held, { gear: { from: 0, to: 10 } })
  assert.ok(performance.now() - t0 < 1000)
  replay(toCounts(held), plan.gear as SectionPlan, 'gear')
})

/** Best (reachedKey, -value, -overshoot) over every valid operation sequence, merges anywhere. */
function bruteForceGear(
  counts: number[],
  from: number,
  to: number,
  opts: { fraction?: number; spares?: number[] } = {}
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
    sp.forEach((t, j) => {
      if (xp + 2 ** t <= MAX_XP) visit(c, xp + 2 ** t, value, sp.filter((_, k) => k !== j))
    })
    for (let i = 0; i < c.length; i++) {
      if (c[i] === 0) continue
      if (tierOf(xp) <= MOTES[i].itemCap && xp + MOTES[i].itemXp <= MAX_XP) {
        const n = [...c]
        n[i]--
        visit(n, xp + MOTES[i].itemXp, value + MOTES[i].spellXp, sp)
      }
      if (c[i] >= 2 && i + 1 <= idx('Mote of Ascendant Potential')) {
        const n = [...c]
        n[i] -= 2
        n[i + 1]++
        visit(n, xp, value, sp)
      }
    }
  }
  visit(counts, cum(from) + (opts.fraction ?? 0), 0, [...(opts.spares ?? [])].sort((a, b) => a - b))
  return best
}

test('gear DP matches exhaustive search on random small pools', () => {
  let seed = 12345
  const rand = (n: number): number => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31
    return seed % n
  }
  for (let trial = 0; trial < 400; trial++) {
    const held: Partial<Record<MoteName, number>> = {}
    for (let i = 0; i < 7; i++) if (rand(3)) held[NAMES[i]] = rand(5)
    const from = rand(5)
    const to = from + 1 + rand(3)
    const plan = planMotes(held, { gear: { from, to } })
    const got = replay(toCounts(held), plan.gear as SectionPlan, 'gear')
    const target = cum(to)
    const expected = bruteForceGear(toCounts(held), from, to)
    assert.deepEqual(
      [Math.min(got.xp, target), -got.value, -Math.max(0, got.xp - target)],
      expected,
      `trial ${trial}: ${JSON.stringify(held)} ${from}->${to}`
    )
  }
})

test("owner's example: +7 -> +8 with spare +0, +1, +7 copies merges the +7 and spends no mote", () => {
  const spares = [0, 1, 7]
  const plan = planMotes(OWNER, { gear: { from: 7, to: 8, spares } })
  const gear = plan.gear as SectionPlan
  replay(toCounts(OWNER), gear, 'gear', { spares })
  assert.deepEqual(gear.steps, [{ kind: 'merge', tier: 7, count: 1, after: { full: 8, fraction: 0 } }])
  assert.deepEqual(toCounts(plan.remaining), toCounts(OWNER), 'no mote spent')
})

test('spare copies fill the gap motes leave, and are merged after every capped mote', () => {
  // 0 -> 3 needs 7 XP. Infinitesimal (cap 0) only fits at tier 0, so it must go before the +2 copy.
  const held = { 'Mote of Infinitesimal Potential': 1 }
  const spares = [2, 1]
  const plan = planMotes(held, { gear: { from: 0, to: 3, spares } })
  const gear = plan.gear as SectionPlan
  const got = replay(toCounts(held), gear, 'gear', { spares })
  assert.equal(got.xp, 7)
  assert.equal(gear.steps[0].kind, 'apply')
  assert.ok(gear.steps.slice(1).every((s) => s.kind === 'merge'))
})

test('banked progress counts: +4 at 5/16 needs 11 more XP to reach +5', () => {
  // Major (5) + Greater (6) is exactly 11; the Infinite would also do it, at far more spell value.
  const held = { 'Mote of Major Potential': 1, 'Mote of Greater Potential': 1, 'Mote of Infinite Potential': 1 }
  const plan = planMotes(held, { gear: { from: 4, to: 5, fraction: 5 } })
  const gear = plan.gear as SectionPlan
  replay(toCounts(held), gear, 'gear', { fraction: 5 })
  assert.deepEqual(gear.reached, { full: 5, fraction: 0 })
  assert.equal(gear.overshootXp, 0)
  assert.equal(plan.remaining['Mote of Infinite Potential'], 1)
})

test('fraction and spare tiers are validated', () => {
  assert.throws(() => planMotes({}, { gear: { from: 4, to: 5, fraction: 16 } }), /fraction/)
  assert.throws(() => planMotes({}, { gear: { from: 4, to: 5, fraction: -1 } }), /fraction/)
  assert.throws(() => planMotes({}, { gear: { from: 4, to: 5, spares: [10] } }), /spares/)
})

test('gear DP with spare copies and banked progress matches exhaustive search', () => {
  let seed = 777
  const rand = (n: number): number => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31
    return seed % n
  }
  for (let trial = 0; trial < 250; trial++) {
    const held: Partial<Record<MoteName, number>> = {}
    for (let i = 0; i < 6; i++) if (rand(3)) held[NAMES[i]] = rand(4)
    const from = rand(5)
    const to = from + 1 + rand(3)
    const fraction = rand(2 ** from)
    const spares = Array.from({ length: rand(4) }, () => rand(7))
    const plan = planMotes(held, { gear: { from, to, fraction, spares } })
    const got = replay(toCounts(held), plan.gear as SectionPlan, 'gear', { fraction, spares })
    const target = cum(to)
    assert.deepEqual(
      [Math.min(got.xp, target), -got.value, -Math.max(0, got.xp - target)],
      bruteForceGear(toCounts(held), from, to, { fraction, spares }),
      `trial ${trial}: ${JSON.stringify(held)} ${from}(+${fraction})->${to} spares ${JSON.stringify(spares)}`
    )
  }
})

test('spell steps are listed smallest mote first, like gear', () => {
  const spell = planMotes(OWNER, { spell: { from: 0, to: 10 } }).spell as SectionPlan
  replay(toCounts(OWNER), spell, 'spell')
  const order = spell.steps.map((s) => (s.kind === 'apply' ? idx(s.mote) : -1))
  assert.deepEqual(order, [...order].sort((a, b) => a - b))
  assert.equal(spell.steps[0].kind === 'apply' && spell.steps[0].mote, 'Mote of Infinitesimal Potential')
})
