// The Cleanup tab's "Can destroy" count: what is left of an item after every turn-in you hold
// sets for, keeping KEEP_EXTRA_TURN_INS more turn-ins' worth on top.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { KEEP_EXTRA_TURN_INS, cleanupRows } from '../src/renderer/src/features/posky/cleanup'

const quest = (key: string, items: { name: string; count: number }[]) => ({
  key,
  className: 'Warrior',
  name: key,
  items
})

test('surplus beyond the scarcest item, less the extra margin, is destroyable', () => {
  assert.equal(KEEP_EXTRA_TURN_INS, 3)
  const q = quest('Warrior::Test', [
    { name: 'Sphinx Claw', count: 1 },
    { name: 'Wind Rune', count: 1 }
  ])
  const rows = cleanupRows([q], { 'Warrior::Test': 1 }, { 'sphinx claw': 10, 'wind rune': 2 })
  // 2 turn-ins (the runes decide), keep 2 + 3 = 5 claws, destroy the other 5.
  assert.equal(rows.find((r) => r.name === 'Sphinx Claw')?.destroyable, 5)
  assert.equal(rows.find((r) => r.name === 'Wind Rune')?.destroyable, 0)
})

test('the margin is in turn-ins, so a multi-copy need keeps whole sets', () => {
  const q = quest('Warrior::Claws', [{ name: 'Sphinx Claw', count: 5 }])
  const rows = cleanupRows([q], { 'Warrior::Claws': 1 }, { 'sphinx claw': 42 })
  // 8 sets in hand, keep (8 + 3) * 5 = 55 > 42: nothing to destroy.
  assert.equal(rows[0].destroyable, 0)
})

test('two quests sharing an item each reserve their own copies', () => {
  const a = quest('Warrior::A', [
    { name: 'Sphinx Claw', count: 1 },
    { name: 'Griffon Feather', count: 1 }
  ])
  const b = quest('Warrior::B', [
    { name: 'Sphinx Claw', count: 1 },
    { name: 'Wind Rune', count: 1 }
  ])
  const rows = cleanupRows(
    [a, b],
    { 'Warrior::A': 1, 'Warrior::B': 1 },
    { 'sphinx claw': 20, 'griffon feather': 4, 'wind rune': 1 }
  )
  // A: 4 sets + 3 = 7 claws; B: 1 set + 3 = 4 claws. 20 - 11 = 9.
  assert.equal(rows.find((r) => r.name === 'Sphinx Claw')?.destroyable, 9)
})
