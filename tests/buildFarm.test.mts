// The Builds tab's Farm view: copies still to farm per piece for +7..+10 (src/shared/buildFarm.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Build } from '../src/shared/builds'
import type { LootEvent } from '../src/shared/types'
import {
  farmCells,
  farmTargets,
  farmTotals,
  lootSeen,
  moteSummary,
  ownedCopies
} from '../src/shared/buildFarm'

const build = (slots: Build['slots']): Build => ({ id: 'b', name: 'B', slots })

test('the dump: worn and Equipment key-ring copies are pieces, containers and hoard are spares, sockets are skipped', () => {
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

test('the log: the usual drop tier and who dropped it', () => {
  const loot: LootEvent[] = [
    { ts: 1, item: 'Ethereal Mist Greaves +4', source: 'a storm giant', zone: 'Plane of Sky' },
    { ts: 2, item: 'Ethereal Mist Greaves +4', source: 'a storm giant', zone: 'Plane of Sky' },
    { ts: 3, item: 'Ethereal Mist Greaves +1' }
  ]
  const seen = lootSeen(loot).get('ethereal mist greaves')
  assert.equal(seen?.dropTier, 4)
  assert.deepEqual(seen?.sources, [{ label: 'a storm giant (Plane of Sky)', count: 2 }])
})

test('a +7 piece with spares: copies per target, levelled to +5 or merged as they drop', () => {
  const owned = ownedCopies([
    { name: 'Weight of the Gods +7', location: 'Shoulders', lane: 'worn' },
    { name: 'Weight of the Gods +1', location: 'General 6', lane: 'bags' },
    { name: 'Weight of the Gods', location: 'General 7', lane: 'bags' }
  ])
  const seen = lootSeen([{ ts: 1, item: 'Weight of the Gods +4' }])
  const [cell] = farmCells(build({ SHOULDERS: { name: 'Weight of the Gods' } }), owned, seen, {})
  assert.equal(cell.tier, 7)
  assert.equal(cell.needs[7], null)
  // +7 -> +8 is 128 XP. Levelled: spares give 32 + 32, then 64 / 32 = 2 copies. Raw: 2 + 1, 125 / 16 = 8.
  assert.deepEqual(cell.needs[8], { lo: 2, hi: 8 })
  // +7 -> +10 is 896 XP: (896 - 64) / 32 = 26; (896 - 3) / 16 = 56.
  assert.deepEqual(cell.needs[10], { lo: 26, hi: 56 })
})

test('a piece you do not own: the first copy becomes it, and the totals add up', () => {
  const cells = farmCells(
    build({ HEAD: { name: 'Golden Efreeti Turban' }, FACE: { name: 'Triumphant Mask' } }),
    ownedCopies([{ name: 'Triumphant Mask +10', location: 'Face', lane: 'worn' }]),
    new Map(),
    { 'golden efreeti turban': { drops: [{ mob: 'Noble Dojorn', zone: 'Plane of Sky' }], quests: [] } }
  )
  const turban = cells.find((c) => c.item === 'Golden Efreeti Turban')
  assert.equal(turban?.tier, null)
  assert.equal(turban?.dropSeen, false)
  // dropping at +0: 127 XP to +7 -> 1 + ceil(127 / 32) = 5 levelled, 1 + 127 = 128 raw.
  assert.deepEqual(turban?.needs[7], { lo: 5, hi: 128 })
  assert.deepEqual(farmTotals(cells)[7], { lo: 5, hi: 128 })
  assert.deepEqual(
    farmTargets(cells, 7).map((t) => t.label),
    ['Noble Dojorn (Plane of Sky)']
  )
})

test('motes: how many copies the Majors level to +5, and what Greater-and-up add', () => {
  const s = moteSummary({
    'Mote of Major Potential': 215,
    'Mote of Greater Potential': 29,
    'Mote of Superior Potential': 8,
    'Mote of Grand Potential': 1,
    'Mote of Ascendant Potential': 1
  })
  // +4 -> +5 is 16 XP = 4 Majors; +0 -> +5 is 31 XP = 7 Majors.
  assert.deepEqual(s, { majors: 215, boostsFrom4: 53, boostsFrom0: 30, highXp: 29 * 6 + 8 * 7 + 8 + 9 })
})
