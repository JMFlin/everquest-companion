// MOTE PLANNER TEST — src/shared/planner/motes.ts.
//
// Every plan is REPLAYED through an independent simulator of the game rules (condense pairs,
// gear cap per application, the 1023 ceiling), so a plan that reads right but cannot be executed
// fails here. Gear optimality is cross-checked against exhaustive search over every valid
// operation sequence (any order, any interleaving of condense and apply) on small random pools,
// with condensing both allowed and off.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MOTES, planMotes, type MoteName, type SectionPlan, type Step } from '../src/shared/planner/motes'
import {
  MAX_XP,
  NAMES,
  OWNER,
  bruteForceGear,
  cum,
  idx,
  lexGreater,
  replay,
  spellValue,
  toCounts
} from './motePlannerFixture.mts'

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
    {
      kind: 'apply',
      mote: 'Mote of Greater Potential',
      count: 1,
      after: { full: 5, fraction: 1 }
    }
  ])
  assert.equal(spell.overshootXp, 25)
})

test('spell never passes 1023, even to finish', () => {
  const held = {
    'Mote of Infinite Potential': 2,
    'Mote of Grand Potential': 1
  }
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
    {
      kind: 'apply',
      mote: 'Mote of Potential',
      count: 2,
      after: { full: 3, fraction: 1 }
    }
  ])
  assert.equal(gear.overshootXp, 1)
  replay(toCounts(held), gear, 'gear')
})

test('gear applies in ascending cap order (Infinitesimal only fits at tier 0)', () => {
  const held = { 'Mote of Infinitesimal Potential': 1, 'Mote of Potential': 1 }
  const gear = planMotes(held, { gear: { from: 0, to: 3 } }).gear as SectionPlan
  assert.deepEqual(gear.steps, [
    {
      kind: 'apply',
      mote: 'Mote of Infinitesimal Potential',
      count: 1,
      after: { full: 1, fraction: 0 }
    },
    {
      kind: 'apply',
      mote: 'Mote of Potential',
      count: 1,
      after: { full: 2, fraction: 2 }
    }
  ])
  assert.equal(gear.shortfallXp, 2)
})

test('gear condenses to unlock a higher cap', () => {
  const held = { 'Mote of Potential': 4 }
  const plan = planMotes(held, { gear: { from: 3, to: 5, condense: true } })
  const gear = plan.gear as SectionPlan
  assert.deepEqual(gear.steps, [
    {
      kind: 'condense',
      mote: 'Mote of Potential',
      pairs: 1,
      into: 'Mote of Major Potential'
    },
    {
      kind: 'apply',
      mote: 'Mote of Potential',
      count: 2,
      after: { full: 4, fraction: 0 }
    },
    {
      kind: 'apply',
      mote: 'Mote of Major Potential',
      count: 1,
      after: { full: 4, fraction: 5 }
    }
  ])
  assert.equal(gear.shortfallXp, 11)
  assert.equal(plan.remaining['Mote of Potential'], 0)
  replay(toCounts(held), gear, 'gear', { condense: true })
})

test('gear never condenses unless asked', () => {
  const held = { 'Mote of Potential': 4 }
  const plan = planMotes(held, { gear: { from: 3, to: 5 } })
  const gear = plan.gear as SectionPlan
  assert.deepEqual(gear.steps, [
    {
      kind: 'apply',
      mote: 'Mote of Potential',
      count: 2,
      after: { full: 4, fraction: 0 }
    }
  ])
  assert.equal(gear.shortfallXp, 16)
  assert.equal(plan.remaining['Mote of Potential'], 2)
  replay(toCounts(held), gear, 'gear')
})

test('gear never passes 1023', () => {
  const gear = planMotes({ 'Mote of Infinite Potential': 60 }, { gear: { from: 9, to: 10 } }).gear as SectionPlan
  assert.deepEqual(gear.reached, { full: 9, fraction: 510 })
  assert.equal(gear.shortfallXp, 2)
})

test('shared pool: gear then spell never double-books', () => {
  const plan = planMotes(OWNER, {
    gear: { from: 0, to: 7, condense: true },
    spell: { from: 0, to: 10 }
  })
  const counts = toCounts(OWNER)
  const gear = replay(counts, plan.gear as SectionPlan, 'gear', {
    condense: true
  })
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

test('hoards stay fast and plan as the clamped pool does', () => {
  // With every tier held past its own application limit nothing is worth condensing, so the
  // clamped pool is exactly each tier's application limit (cap window and 1023 horizon).
  const limit = MOTES.map((m) =>
    Math.min(Math.ceil((2 ** (m.itemCap + 1) - 1) / m.itemXp), Math.floor(MAX_XP / m.itemXp))
  )
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
  const held = {
    'Mote of Infinitesimal Potential': 1000,
    'Mote of Minor Potential': 1000
  }
  const t0 = performance.now()
  const plan = planMotes(held, { gear: { from: 0, to: 10, condense: true } })
  assert.ok(performance.now() - t0 < 1000)
  replay(toCounts(held), plan.gear as SectionPlan, 'gear', { condense: true })
})

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
    const condense = trial % 2 === 0
    const plan = planMotes(held, { gear: { from, to, condense } })
    const got = replay(toCounts(held), plan.gear as SectionPlan, 'gear', {
      condense
    })
    const target = cum(to)
    const expected = bruteForceGear(toCounts(held), from, to, { condense })
    assert.deepEqual(
      [Math.min(got.xp, target), -got.value, -Math.max(0, got.xp - target)],
      expected,
      `trial ${trial}: ${JSON.stringify(held)} ${from}->${to} condense ${condense}`
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
  const held = {
    'Mote of Major Potential': 1,
    'Mote of Greater Potential': 1,
    'Mote of Infinite Potential': 1
  }
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

test('gear with spare copies and banked progress never does worse than merging them as they are', () => {
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
    const condense = trial % 2 === 0
    const plan = planMotes(held, {
      gear: { from, to, fraction, spares, condense }
    })
    const got = replay(toCounts(held), plan.gear as SectionPlan, 'gear', {
      fraction,
      spares,
      condense
    })
    const target = cum(to)
    const score = [Math.min(got.xp, target), -got.value, -Math.max(0, got.xp - target)]
    assert.ok(
      !lexGreater(
        bruteForceGear(toCounts(held), from, to, {
          fraction,
          spares,
          condense
        }),
        score
      ),
      `trial ${trial}: ${JSON.stringify(held)} ${from}(+${fraction})->${to} spares ${JSON.stringify(spares)} condense ${condense}`
    )
  }
})

test('spell steps are listed smallest mote first, like gear', () => {
  const spell = planMotes(OWNER, { spell: { from: 0, to: 10 } }).spell as SectionPlan
  replay(toCounts(OWNER), spell, 'spell')
  const order = spell.steps.map((s) => (s.kind === 'apply' ? idx(s.mote) : -1))
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b)
  )
  assert.equal(spell.steps[0].kind === 'apply' && spell.steps[0].mote, 'Mote of Infinitesimal Potential')
})

test('spell banked progress counts: rank 4 at 5/16 needs 11 more XP to reach rank 5', () => {
  // 11 = Potential (8) + Minor (2) + Infinitesimal (1), exactly.
  const plan = planMotes(OWNER, { spell: { from: 4, to: 5, fraction: 5 } })
  const spell = plan.spell as SectionPlan
  replay(toCounts(OWNER), spell, 'spell', { fraction: 5 })
  assert.deepEqual(spell.reached, { full: 5, fraction: 0 })
  assert.equal(spell.overshootXp, 0)
  assert.deepEqual(
    spell.steps.map((s) => (s.kind === 'apply' ? [s.mote, s.count] : [])),
    [
      ['Mote of Infinitesimal Potential', 1],
      ['Mote of Minor Potential', 1],
      ['Mote of Potential', 1]
    ]
  )
})

test("owner's +5 -> +8 with a spare +0 levels the spare on low motes and keeps Greaters for the piece", () => {
  const gear = planMotes(OWNER, { gear: { from: 5, to: 8, spares: [0] } }).gear as SectionPlan
  replay(toCounts(OWNER), gear, 'gear', { spares: [0] })
  const has = (kind: Step['kind'], mote: MoteName): boolean =>
    gear.steps.some((s) => s.kind === kind && 'mote' in s && s.mote === mote)
  assert.ok(has('level', 'Mote of Infinitesimal Potential') && has('apply', 'Mote of Greater Potential'))
})

test('several spares stay fast', () => {
  const t0 = performance.now()
  const plan = planMotes(OWNER, {
    gear: { from: 0, to: 10, spares: [0, 0, 3, 5], condense: true }
  })
  assert.ok(performance.now() - t0 < 2000)
  replay(toCounts(OWNER), plan.gear as SectionPlan, 'gear', {
    spares: [0, 0, 3, 5],
    condense: true
  })
})
