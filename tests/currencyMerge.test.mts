// Several captures of one currency window, merged (src/main/currencyScan/merge.ts). Cases are the
// owner's 16 px scan of 2026-10-24: the game-window capture lost Izah's quantity, the Chromium one
// lost Greater and invented a ghost row, the screen capture read all 24.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeReads } from '../src/main/currencyScan/merge'

const ALL: Record<string, number> = { Azia: 7, Izah: 4, Greater: 13, Potential: 10 }
const without = (k: string): Record<string, number> => Object.fromEntries(Object.entries(ALL).filter(([n]) => n !== k))

test('a read with no unreadable rows is complete on its own', () => {
  assert.deepEqual(mergeReads([{ counts: ALL, unmatched: [] }]), { counts: ALL, unmatched: [], complete: true })
})

test('one read missing a row is not complete alone', () => {
  const r = mergeReads([{ counts: without('Izah'), unmatched: ['* Izah Wind Runes | | ?'] }])
  assert.equal(r.complete, false)
  assert.deepEqual(r.unmatched, ['* Izah Wind Runes | | ?'])
})

test('two reads cover each other, and a ghost row in one does not block the other', () => {
  const game = { counts: without('Izah'), unmatched: ['* Izah Wind Runes | | ?'] }
  const chromium = { counts: without('Greater'), unmatched: ['@Motes of Greater Potential | ?', 'J of Potential | | ?'] }
  assert.deepEqual(mergeReads([game, chromium]), { counts: ALL, unmatched: [], complete: true })
})

test('captures that disagree on a count are never saved', () => {
  const r = mergeReads([{ counts: ALL, unmatched: [] }, { counts: { ...ALL, Izah: 1 }, unmatched: [] }])
  assert.equal(r.complete, false)
  assert.ok(!('Izah' in r.counts))
  assert.deepEqual(r.unmatched, ['Izah: 4 vs 1'])
})
