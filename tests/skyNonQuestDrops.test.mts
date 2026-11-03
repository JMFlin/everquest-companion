// Plane of Sky drops that no quest requires: the Cleanup tab's second table.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { MobEntry } from '../src/shared/types'
import {
  epicClassesByItem,
  epicClassesOf,
  nonQuestDropRows,
  nonQuestDrops,
  skyNonQuestDrops
} from '../src/renderer/src/features/posky/nonQuestDrops'

const mob = (name: string, drops: string[]): MobEntry =>
  ({ name, page: name, zones: ['Plane of Sky'], drops }) as MobEntry

test('a drop any quest requires is left out, the rest listed once with every dropper', () => {
  const drops = nonQuestDrops(
    [mob('Spiroc Guardian', ['Sphinx Claw', 'Sky Pearl']), mob('Azarack', ['Sky Pearl +1'])],
    ['Sphinx Claw'],
    new Map()
  )
  assert.deepEqual(
    drops.map((d) => [d.name, d.droppers.map((m) => m.name)]),
    [['Sky Pearl', ['Azarack', 'Spiroc Guardian']]]
  )
})

test('rows put what the export says you hold first', () => {
  const drops = nonQuestDrops([mob('Azarack', ['Bluish Stone', 'Sky Pearl'])], [], new Map())
  const rows = nonQuestDropRows(drops, { 'sky pearl': [{ label: 'Bank', count: 4 }] })
  assert.deepEqual(
    rows.map((r) => [r.name, r.held]),
    [
      ['Sky Pearl', 4],
      ['Bluish Stone', 0]
    ]
  )
})

test('the committed data: Sky quest items and other quests\' turn-ins are excluded', () => {
  const names = new Set(skyNonQuestDrops().map((d) => d.name.toLowerCase()))
  assert.ok(names.has('pearlescent globe'))
  assert.ok(!names.has('bird whistle'), 'turned in by a quest outside the Sky tracker')
  assert.ok(!names.has('sphinx claw'), 'a Sky quest item')
})

test('epic quests are indexed by class, and only quests named <Class> Epic Quest count', () => {
  const epics = epicClassesByItem([
    { name: 'Necromancer Epic Quest', requiredItems: ['Spiroc Feathers', 'Silver Disc'] },
    { name: 'Monk Epic Quest', requiredItems: ['Silver Disc'] },
    { name: 'Epic Fishing', requiredItems: ['Sky Pearl'] }
  ])
  assert.deepEqual(epics.get('silver disc'), ['Necromancer', 'Monk'])
  assert.equal(epics.get('sky pearl'), undefined)
})

test('the committed data: epic-only drops are listed and marked, epic Sky quest items marked too', () => {
  const byName = new Map(skyNonQuestDrops().map((d) => [d.name.toLowerCase(), d]))
  assert.deepEqual(byName.get('blade of abrogation')?.epics, ['Shadow Knight'])
  assert.deepEqual(byName.get('pearlescent globe')?.epics, [])
  assert.deepEqual(epicClassesOf('Black Silk Cape'), ['Necromancer'])
})
