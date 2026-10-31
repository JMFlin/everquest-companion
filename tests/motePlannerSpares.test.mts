// MOTE PLANNER, MANY SPARE COPIES — src/shared/planner/moteGearSearch.ts.
//
// Plans are replayed and cross-checked exactly as in tests/motePlanner.test.mts. Several copies
// must share the cheap low-cap motes between them: one Infinitesimal per +0 copy, not one copy
// levelled alone.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planMotes, stepGroups, type MoteName, type SectionPlan } from '../src/shared/planner/motes'
import { NAMES, bruteForceGear, cum, replay, toCounts } from './motePlannerFixture.mts'

test('gear DP levelling several spares matches exhaustive search', () => {
  let seed = 4242
  const rand = (n: number): number => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31
    return seed % n
  }
  for (let trial = 0; trial < 150; trial++) {
    const held: Partial<Record<MoteName, number>> = {}
    for (let i = 0; i < 4; i++) if (rand(4)) held[NAMES[i]] = rand(5)
    const spares = Array.from({ length: 2 + rand(3) }, () => rand(2))
    const [from, fraction, condense] = [2 + rand(3), 0, trial % 2 === 0]
    const to = from + 1 + rand(3)
    const plan = planMotes(held, {
      gear: { from, to, fraction, spares, condense }
    })
    const got = replay(toCounts(held), plan.gear as SectionPlan, 'gear', {
      fraction,
      spares,
      condense
    })
    assert.deepEqual(
      [Math.min(got.xp, cum(to)), -got.value, -Math.max(0, got.xp - cum(to))],
      bruteForceGear(toCounts(held), from, to, {
        fraction,
        spares,
        condense,
        level: true
      }),
      `trial ${trial}: ${JSON.stringify(held)} ${from}->${to} spares ${JSON.stringify(spares)} condense ${condense}`
    )
  }
})

test('three +0 copies each take one Infinitesimal rather than one copy taking them all', () => {
  // +3 -> +4 is 8 XP; the copies merge for 3. An Infinitesimal on each (+3) and two Minors on one
  // of them (+2) make 8 for 7 value; levelling a single copy cannot use more than one Infinitesimal.
  const held = {
    'Mote of Infinitesimal Potential': 3,
    'Mote of Minor Potential': 2,
    'Mote of Potential': 2
  }
  const spares = [0, 0, 0]
  const plan = planMotes(held, { gear: { from: 3, to: 4, spares } })
  const got = replay(toCounts(held), plan.gear as SectionPlan, 'gear', {
    spares
  })
  assert.deepEqual(
    [Math.min(got.xp, cum(4)), -got.value, -Math.max(0, got.xp - cum(4))],
    bruteForceGear(toCounts(held), 3, 4, { spares, level: true })
  )
  assert.equal(got.value, 7)
})

test('+4 -> +6 with twelve +0 and five +1 copies spreads the cheapest motes over many copies', () => {
  // 48 XP: merging the copies as they are gives 22. One Infinitesimal per +0 copy (+12) and two
  // Minors on each of seven +1 copies (+14) close the gap for 12 + 28 = 40, the least possible.
  const held = {
    'Mote of Infinitesimal Potential': 20,
    'Mote of Minor Potential': 15,
    'Mote of Lesser Potential': 10,
    'Mote of Potential': 8,
    'Mote of Major Potential': 5,
    'Mote of Greater Potential': 3,
    'Mote of Superior Potential': 1
  }
  const spares = [...Array(12).fill(0), ...Array(5).fill(1)]
  const t0 = performance.now()
  const plan = planMotes(held, { gear: { from: 4, to: 6, spares } })
  assert.ok(performance.now() - t0 < 2000)
  const got = replay(toCounts(held), plan.gear as SectionPlan, 'gear', {
    spares
  })
  assert.equal(got.xp, cum(6))
  assert.equal(got.value, 40)
  assert.equal(plan.remaining['Mote of Potential'], 8)
  assert.equal(plan.remaining['Mote of Lesser Potential'], 10)
})

test('at equal value gear spends lower-tier motes and keeps the higher ones', () => {
  // 0 -> 2 is 3 XP: three Minors or a Minor and a Lesser cost the same 6.
  const held = { 'Mote of Minor Potential': 3, 'Mote of Lesser Potential': 1 }
  const plan = planMotes(held, { gear: { from: 0, to: 2 } })
  replay(toCounts(held), plan.gear as SectionPlan, 'gear')
  assert.equal(plan.remaining['Mote of Lesser Potential'], 1)
  assert.equal(plan.remaining['Mote of Minor Potential'], 0)
})

test('stepGroups splits a plan into condensing, each levelled spare, then the main item', () => {
  const held = { 'Mote of Infinitesimal Potential': 2, 'Mote of Minor Potential': 4 }
  const plan = planMotes(held, { gear: { from: 2, to: 4, spares: [0, 0, 3], condense: true } })
  const steps = (plan.gear as SectionPlan).steps
  const groups = stepGroups(steps)
  assert.deepEqual(
    groups.map((g) => g.kind),
    [...(steps.some((s) => s.kind === 'condense') ? ['condense'] : []), 'spare', 'spare', 'main']
  )
  assert.deepEqual(
    groups.filter((g) => g.kind === 'spare').map((g) => g.kind === 'spare' && [g.spare, g.from]),
    [[0, 0], [1, 0]]
  )
  assert.ok(groups.at(-1)?.steps.every((s) => s.kind === 'apply' || s.kind === 'merge'))
  assert.equal(groups.flatMap((g) => g.steps).length, steps.length)
})

test('stepGroups keeps a plan without spare copies as one flat group', () => {
  const plan = planMotes({ 'Mote of Minor Potential': 3 }, { gear: { from: 0, to: 2 } })
  const steps = (plan.gear as SectionPlan).steps
  assert.deepEqual(stepGroups(steps), [{ kind: 'all', steps }])
})
