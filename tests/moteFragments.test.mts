import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FRAGMENTS, MOTES, UPGRADE_CURRENCIES, planMotes, type SectionPlan, type UpgradeCurrencyName } from '../src/shared/planner/motes'
import { MAX_XP, cumXp, stateAt } from '../src/shared/planner/moteXp'

const major = 'Fragment of Major Potential'
const greater = 'Fragment of Greater Potential'

function value(plan: SectionPlan): number {
  return plan.steps.reduce((sum, step) => {
    if (step.kind === 'merge' || step.kind === 'condense') return sum
    const currency = UPGRADE_CURRENCIES.find((m) => m.name === step.mote)
    assert.ok(currency)
    return sum + step.count * currency.spellXp
  }, 0)
}

test('fragment spell XP and known gear XP remain separate from motes', () => {
  assert.deepEqual(FRAGMENTS.map((m) => m.spellXp), [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024])
  assert.deepEqual(FRAGMENTS.map((m) => m.itemXp), [null, null, null, null, 8, 11, null, null, null, null])
  assert.deepEqual(FRAGMENTS.map((m) => m.itemCap), MOTES.map((m) => m.itemCap))
})

test('spell shares mote and fragment stock without double spending gear allocations', () => {
  const plan = planMotes({ [major]: 3, [MOTES[0].name]: 1 }, {
    gear: { from: 4, to: 5 }, spell: { from: 5, to: 6 }
  })
  assert.equal(plan.gear?.shortfallXp, 0)
  assert.equal(plan.spell?.shortfallXp, 0)
  assert.equal(plan.remaining[major], 0)
  assert.equal(plan.remaining[MOTES[0].name], 1)
  assert.equal(plan.gear?.steps[0].kind, 'apply')
  assert.equal(value(plan.gear as SectionPlan), 64)
  assert.equal(value(plan.spell as SectionPlan), 32)
})

test('unknown fragment gear gains are untouched and still available for spells', () => {
  const unknown = 'Fragment of Lesser Potential'
  const gearOnly = planMotes({ [unknown]: 4 }, { gear: { from: 2, to: 3 } })
  assert.equal(gearOnly.gear?.shortfallXp, 4)
  assert.equal(gearOnly.remaining[unknown], 4)
  const spell = planMotes({ [unknown]: 4 }, { spell: { from: 3, to: 4 } })
  assert.equal(spell.spell?.shortfallXp, 0)
  assert.equal(spell.remaining[unknown], 3)
})

test('max grade and current item cap apply to fragments', () => {
  const capped = planMotes({ [major]: 5, [greater]: 5 }, { gear: { from: 5, to: 6 } }, 4)
  assert.equal(capped.gear?.shortfallXp, 32)
  assert.equal(capped.remaining[major], 5)
  assert.equal(capped.remaining[greater], 5)
  const usable = planMotes({ [major]: 5, [greater]: 3 }, { gear: { from: 5, to: 6 } })
  assert.equal(usable.gear?.shortfallXp, 0)
  assert.equal(usable.remaining[major], 5)
  assert.equal(usable.remaining[greater], 0)
})

test('an Infinite fragment cannot pass the maximum XP invariant', () => {
  const infinite = 'Fragment of Infinite Potential'
  const plan = planMotes({ [infinite]: 1 }, { spell: { from: 0, to: 10 } })
  assert.equal(plan.spell?.shortfallXp, MAX_XP)
  assert.equal(plan.remaining[infinite], 1)
})

test('mixed gear stock saves spell value and never condenses fragments', () => {
  const plan = planMotes({ [major]: 2, [MOTES[4].name]: 4 }, { gear: { from: 4, to: 5, condense: true } })
  assert.equal(plan.gear?.shortfallXp, 0)
  assert.equal(value(plan.gear as SectionPlan), 64)
  for (const step of plan.gear?.steps ?? []) {
    if (step.kind === 'condense') assert.ok(step.mote.startsWith('Mote of '))
  }
})

test('fragment levelling of multiple spare copies is assigned and merged correctly', () => {
  const plan = planMotes({ [major]: 4 }, { gear: { from: 5, to: 6, spares: [3, 3] } })
  assert.equal(plan.gear?.shortfallXp, 0)
  assert.equal(value(plan.gear as SectionPlan), 64)
  assert.equal(plan.remaining[major], 2)
  assert.equal(plan.gear?.steps.filter((s) => s.kind === 'level').length, 2)
})

// Enumerate every legal main-item application order, independently of the tiered DP.
function exhaustive(held: Partial<Record<UpgradeCurrencyName, number>>, from: number, to: number): number[] {
  const currencies = UPGRADE_CURRENCIES.filter((m) => m.itemXp !== null && (held[m.name] ?? 0) > 0)
  const target = cumXp(to)
  let best = [Math.min(cumXp(from), target), 0, 0]
  const seen = new Set<string>()
  const visit = (xp: number, counts: number[], spent: number): void => {
    const key = `${xp}|${counts.join(',')}`
    if (seen.has(key)) return
    seen.add(key)
    const score = [Math.min(xp, target), -spent, -Math.max(0, xp - target)]
    if (score[0] > best[0] || (score[0] === best[0] && (score[1] > best[1] || (score[1] === best[1] && score[2] > best[2])))) best = score
    if (xp >= target) return
    currencies.forEach((m, i) => {
      const gain = m.itemXp as number
      if (counts[i] === 0 || stateAt(xp).full > m.itemCap || xp + gain > MAX_XP) return
      const left = [...counts]
      left[i]--
      visit(xp + gain, left, spent + m.spellXp)
    })
  }
  visit(cumXp(from), currencies.map((m) => held[m.name] ?? 0), 0)
  return best
}

test('mixed mote and fragment gear plans match exhaustive legal application orders', () => {
  for (let motes = 0; motes <= 3; motes++) {
    for (let fragments = 0; fragments <= 3; fragments++) {
      const held = { [MOTES[4].name]: motes, [major]: fragments, [greater]: 2 }
      for (const from of [3, 4, 5]) {
        const plan = planMotes(held, { gear: { from, to: 6 } }).gear as SectionPlan
        const xp = cumXp(plan.reached.full) + plan.reached.fraction
        assert.deepEqual([Math.min(xp, cumXp(6)), -value(plan), -plan.overshootXp], exhaustive(held, from, 6))
      }
    }
  }
})


test('mote condensation carries through fragment stages without creating fragments', () => {
  const plan = planMotes({ [MOTES[4].name]: 6, [greater]: 2 }, {
    gear: { from: 5, to: 6, condense: true }
  })
  assert.equal(plan.gear?.shortfallXp, 0)
  assert.equal(plan.gear?.overshootXp, 2)
  assert.equal(plan.remaining[MOTES[4].name], 2)
  assert.equal(plan.remaining[greater], 0)
  assert.deepEqual(plan.gear?.steps.filter((s) => s.kind === 'condense'), [{
    kind: 'condense', mote: MOTES[4].name, into: MOTES[5].name, pairs: 2
  }])
})
