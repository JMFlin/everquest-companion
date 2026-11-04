// The Builds tab's Farm view: copies and Major motes per piece for +7..+10 (src/shared/buildFarm.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Build } from '../src/shared/builds'
import { MOTES } from '../src/shared/planner/moteXp'
import {
  farmCells,
  farmTargets,
  farmTotals,
  lootSources,
  majorsToBoost,
  moteSummary,
  moteVerdict,
  ownedCopies
} from '../src/shared/buildFarm'

const build = (slots: Build['slots']): Build => ({ id: 'b', name: 'B', slots })

test('a Major is 5 XP with cap +4, so levelling to +5 takes 7 from +0 and 4 from +4', () => {
  const major = MOTES.find((m) => m.name === 'Mote of Major Potential')
  assert.deepEqual([major?.itemXp, major?.itemCap], [5, 4])
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(majorsToBoost), [7, 6, 6, 5, 4, 0])
})

test('the dump: worn and Equipment key-ring copies are pieces, containers and hoard are spares', () => {
  const owned = ownedCopies([
    { name: 'Weight of the Gods +7', location: 'Shoulders', lane: 'worn' },
    { name: 'Weight of the Gods (Exaltation)', location: 'Shoulders-Slot7', lane: 'worn' },
    { name: 'Weight of the Gods +1', location: 'General 6-Slot1', lane: 'bags' },
    { name: 'Weight of the Gods', location: 'Hoard 3', lane: 'elsewhere' },
    { name: 'Cloak of Scales +3', location: 'KeyRing / Equipment', lane: 'keyring' },
    { name: 'Cloak of Scales (Exaltation)', location: 'KeyRing / Augmentation', lane: 'keyring' },
    { name: 'Cloak of Scales', location: 'KeyRing / Activated', lane: 'keyring' }
  ])
  assert.deepEqual(owned.get('weight of the gods'), [
    { tier: 7, place: 'Shoulders', stored: true },
    { tier: 1, place: 'General 6', stored: false },
    { tier: 0, place: 'Hoard 3', stored: false }
  ])
  assert.deepEqual(owned.get('cloak of scales'), [{ tier: 3, place: 'Equipment', stored: true }])
})

test('the log: who dropped each item, most first; a row the log could not place is left out', () => {
  const sources = lootSources([
    { ts: 1, item: 'Checkmate +4', source: 'The Game Master', zone: 'The Plane of Hate - Solo 4 (Refined)' },
    { ts: 2, item: 'Checkmate', source: 'The Game Master', zone: 'The Plane of Hate' },
    { ts: 3, item: 'Checkmate +2', source: 'a guard' }
  ])
  assert.deepEqual(sources.get('checkmate'), [
    { mob: 'The Game Master', zone: 'The Plane of Hate', count: 2 }
  ])
})

test('a +7 piece with two spares: copies exact, Majors a range', () => {
  const owned = ownedCopies([
    { name: 'Weight of the Gods +7', location: 'Shoulders', lane: 'worn' },
    { name: 'Weight of the Gods +1', location: 'General 6', lane: 'bags' },
    { name: 'Weight of the Gods', location: 'General 7', lane: 'bags' }
  ])
  const [cell] = farmCells(build({ SHOULDERS: { name: 'Weight of the Gods' } }), owned, new Map(), {})
  assert.equal(cell.needs[7], null)
  // +7 -> +8 is 128 XP: the spares give 32 + 32 (6 + 7 Majors), then 2 new copies (4-7 Majors each).
  assert.deepEqual(cell.needs[8], { copies: 2, majors: { lo: 21, hi: 27 } })
  // +7 -> +10 is 896 XP: 64 from spares, 832 / 32 = 26 new copies.
  assert.deepEqual(cell.needs[10], { copies: 26, majors: { lo: 117, hi: 195 } })
})

test('a piece below +5 takes Majors itself; a missing piece is one more copy', () => {
  const cells = farmCells(
    build({ HEAD: { name: 'Golden Efreeti Turban' }, EAR: { name: 'Checkmate' }, FACE: { name: 'Triumphant Mask' } }),
    ownedCopies([
      { name: 'Checkmate +4', location: 'Ear', lane: 'worn' },
      { name: 'Checkmate +4', location: 'General 1', lane: 'bags' },
      { name: 'Triumphant Mask +10', location: 'Face', lane: 'worn' }
    ]),
    new Map(),
    { 'golden efreeti turban': { drops: [{ mob: 'Noble Dojorn', zone: 'Plane of Sky' }], quests: [] } }
  )
  const by = (item: string) => cells.find((c) => c.item === item)
  // Checkmate +4 -> +5: 4 Majors. +5 -> +7: 96 XP; the +4 spare levelled gives 32 (4), then 2 new.
  assert.deepEqual(by('Checkmate')?.needs[7], { copies: 2, majors: { lo: 16, hi: 22 } })
  // Turban missing: 1 copy (4-7 Majors to +5), then 96 XP = 3 more.
  assert.deepEqual(by('Golden Efreeti Turban')?.needs[7], { copies: 4, majors: { lo: 16, hi: 28 } })
  assert.equal(by('Triumphant Mask')?.needs[10], null)
  const total = farmTotals(cells)[7]
  assert.deepEqual(total, { copies: 6, majors: { lo: 32, hi: 50 } })
  assert.deepEqual([moteVerdict(total, 60), moteVerdict(total, 40), moteVerdict(total, 10)], ['enough', 'maybe', 'short'])
  assert.deepEqual(farmTargets(cells, 7, new Map()), [
    { zone: 'The Plane of Sky', looted: 0, rows: [{ item: 'Golden Efreeti Turban', mobs: ['Noble Dojorn'] }] }
  ])
})

test('farm targets: grouped by zone, looted zones first, one zone spelled two ways is one place', () => {
  const cells = farmCells(
    build({ HEAD: { name: 'Turban' }, EAR: { name: 'Checkmate' } }),
    new Map(),
    lootSources([
      { ts: 1, item: 'Checkmate', source: 'a hate guard', zone: 'The Plane of Hate - Solo 4 (Refined)' },
      { ts: 2, item: 'Checkmate', source: 'a stray' }
    ]),
    {
      turban: {
        drops: [
          { mob: 'Noble Dojorn', zone: 'Plane of Sky' },
          { mob: 'a hate lord', zone: 'Plane of Hate' },
          { mob: 'a hate lord', zone: 'The Plane of Hate' }
        ],
        quests: []
      }
    }
  )
  assert.deepEqual(farmTargets(cells, 7, new Map()), [
    {
      zone: 'The Plane of Hate',
      looted: 1,
      rows: [
        { item: 'Checkmate', mobs: ['a hate guard'] },
        { item: 'Turban', mobs: ['a hate lord'] }
      ]
    },
    { zone: 'The Plane of Sky', looted: 0, rows: [{ item: 'Turban', mobs: ['Noble Dojorn'] }] }
  ])
})

test('farm targets: a quest reward lists its turn-in items still to gather, less what you hold', () => {
  const cells = farmCells(build({ SHOULDERS: { name: "Ton Po's Shoulder Wraps" } }), new Map(), new Map(), {})
  const recipes = new Map([
    [
      "ton po's shoulder wraps",
      {
        quest: 'Monk Test of Tears',
        components: [
          { item: 'Silken Wrap', count: 1, held: 1, zone: 'The Plane of Sky', mobs: ['Bazzt Zzzt (Island 6)'] },
          { item: 'Wind Rune Beza', count: 1, held: 0, zone: 'The Plane of Sky', mobs: ['any Plane of Sky mob'] },
          { item: 'Spare Feather', count: 1, held: 9, zone: 'The Plane of Sky', mobs: [] }
        ]
      }
    ]
  ])
  // Missing piece to +7: 4 copies, so 4 turn-ins.
  assert.deepEqual(farmTargets(cells, 7, recipes), [
    {
      zone: 'The Plane of Sky',
      looted: 0,
      rows: [
        { item: 'Silken Wrap', forPiece: "Ton Po's Shoulder Wraps", count: 3, mobs: ['Bazzt Zzzt (Island 6)'] },
        { item: 'Wind Rune Beza', forPiece: "Ton Po's Shoulder Wraps", count: 4, mobs: ['any Plane of Sky mob'] }
      ]
    }
  ])
})

test('motes: Majors held, and what Greater-and-up add outside the plan', () => {
  assert.deepEqual(
    moteSummary({
      'Mote of Major Potential': 215,
      'Mote of Greater Potential': 29,
      'Mote of Superior Potential': 8,
      'Mote of Grand Potential': 1,
      'Mote of Ascendant Potential': 1
    }),
    { majors: 215, highXp: 29 * 6 + 8 * 7 + 8 + 9 }
  )
})
