import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classUnlockRows, orderClassUnlockRows } from '../src/renderer/src/features/posky/classUnlocks'
import type { ItemProgress, QuestProgress } from '../src/renderer/src/features/posky/useProgress'

function item(name: string, held: number, need = 1): ItemProgress {
  return { name, held, need, have: Math.min(held, need), who: [], where: '', droppers: [] }
}

function quest(name: string, items: ItemProgress[], turnIns = 0, className = 'Bard'): QuestProgress {
  const needCount = items.reduce((sum, entry) => sum + entry.need, 0)
  const haveCount = items.reduce((sum, entry) => sum + entry.have, 0)
  return {
    key: `${className}:${name}`, className, name, items, needCount, haveCount,
    ratio: needCount > 0 ? haveCount / needCount : 0,
    missing: items.filter((entry) => entry.have < entry.need).map((entry) => entry.name),
    turnIns, logTurnIns: turnIns, completed: turnIns > 0
  }
}

test('completed and ready tests together make a class ready without declaring an unlock', () => {
  const [row] = classUnlockRows([
    quest('Done', [item('Spent drop', 0)], 1),
    quest('Ready', [item('Fresh drop', 1)])
  ], [])
  assert.equal(row.turnedIn, 1)
  assert.equal(row.ready, 1)
  assert.equal(row.total, 2)
  assert.equal(row.readyToFinish, true)
  assert.equal(row.unlocked, false)
})

test('refarmed completed tests do not count as ready or spend the remaining tests items', () => {
  const [row] = classUnlockRows([
    quest('Done', [item('Shared drop', 1)], 3),
    quest('Ready', [item('Shared drop', 1)])
  ], [])
  assert.equal(row.turnedIn, 1)
  assert.equal(row.ready, 1)
  assert.equal(row.readyToFinish, true)
})

test('individually ready tests cannot spend one shared drop twice', () => {
  for (const name of ['Sphinx Claw', 'Wind Rune Azarack']) {
    const [short] = classUnlockRows([
      quest('One', [item(name, 1)]),
      quest('Two', [item(`${name.toUpperCase()} +1`, 1)])
    ], [])
    assert.equal(short.ready, 2)
    assert.equal(short.readyToFinish, false)
    const [enough] = classUnlockRows([
      quest('One', [item(name, 3)]),
      quest('Two', [item(`${name.toUpperCase()} +1`, 3, 2)])
    ], [])
    assert.equal(enough.readyToFinish, true)
  }
})

test('missing requirements and unknown empty requirements never report ready to finish', () => {
  for (const remaining of [quest('Missing', [item('Drop', 0)]), quest('Unknown', [])]) {
    const [row] = classUnlockRows([quest('Done', [], 1), remaining], [])
    assert.equal(row.ready, 0)
    assert.equal(row.readyToFinish, false)
  }
  assert.deepEqual(classUnlockRows([], []), [])
})

test('all completed is complete, not ready to finish; observed unlock stays independent', () => {
  const [done] = classUnlockRows([quest('Done', [item('Drop', 1)], 1)], [])
  assert.equal(done.ready, 0)
  assert.equal(done.readyToFinish, false)
  assert.equal(done.source, 'derived')
  const [observed] = classUnlockRows([quest('Ready', [item('Drop', 1)])], [
    { className: 'BARD', ts: 100 }
  ])
  assert.equal(observed.readyToFinish, true)
  assert.equal(observed.source, 'observed')
  assert.equal(observed.unlockedAt, 100)
})

test('readiness is per class; stars precede readiness, then remaining tests and name', () => {
  const rows = classUnlockRows([
    quest('One', [item('Shared drop', 1)], 0, 'Bard'),
    quest('One', [item('Shared drop', 1)], 0, 'Monk'),
    quest('One', [item('Other drop', 0)], 0, 'Cleric'),
    quest('One', [], 1, 'Druid')
  ], [])
  assert.deepEqual(rows.filter((row) => row.readyToFinish).map((row) => row.className), ['Bard', 'Monk'])
  assert.deepEqual(orderClassUnlockRows(rows, () => 0).map((row) => row.className),
    ['Bard', 'Monk', 'Druid', 'Cleric'])
  assert.deepEqual(orderClassUnlockRows(rows, (row) => row.className === 'Cleric' ? 1 : 0)
    .map((row) => row.className), ['Cleric', 'Bard', 'Monk', 'Druid'])
})
