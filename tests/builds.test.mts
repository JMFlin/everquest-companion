// GEAR BUILDS — the build file format, the worn cells, the comparison, and the loadoutlegends import.
//
// Two real fixtures: the dev character's committed dump (`Primitive_freeport-Inventory.txt`) for
// what is worn, and a saved loadoutlegends.com character page (`loadoutlegends-larlen.html`) for
// the importer — a third-party page, so the parser is only ever exercised against this copy.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compareBuild, parseBuildFile, sourceLines, wornCells, type Build } from '../src/shared/builds'
import { parseInventoryDump } from '../src/main/outputs/inventoryParse'
import { parseLoadoutPage } from '../scripts/builds/loadoutLegends'

const fixtures = join(import.meta.dirname, 'fixtures')
const dump = parseInventoryDump(readFileSync(join(fixtures, 'Primitive_freeport-Inventory.txt'), 'utf8'))
const page = readFileSync(join(fixtures, 'loadoutlegends-larlen.html'), 'utf8')
const URL = 'https://www.loadoutlegends.com/characters/larlen-rivervale?quick=1'

test('import: every worn cell of the page, labels mapped onto planner cells', () => {
  const file = parseLoadoutPage(page, URL)
  assert.equal(file.name, 'Larlen (WIZ/BRD/ENC)')
  assert.equal(file.url, URL)
  assert.equal(Object.keys(file.slots).length, 22)
  // Charm and Power are the client's two Any Slots; Range holds anything on Legends.
  assert.equal(file.slots.ANY1?.name, 'Carmine Robe')
  assert.equal(file.slots.ANY2?.name, "Nargon's Staff")
  assert.equal(file.slots.RANGE?.name, "Soldier's Brooch of the Arcane")
  assert.equal(file.slots.EAR2?.name, 'Drop of Crystallized Flame')
  assert.equal(file.slots.FINGER2?.name, "Engineer's Ring")
  assert.deepEqual(file.slots.FACE, {
    name: 'Darkbrood Mask',
    exaltations: { focus: 'Polished Mithril Mask', click: 'Guise of the Deceiver' }
  })
  assert.deepEqual(file.slots.ANY2?.exaltations, { click: 'Staff of Temperate Flux', proc: 'Orb of Tishan' })
  assert.equal(file.slots.HANDS?.exaltations, undefined, 'no exaltations → no key')
  // What the importer writes, the app reads.
  assert.equal(parseBuildFile('larlen-rivervale', file).slots.FACE?.name, 'Darkbrood Mask')
})

test('import: a page without the flight payload throws instead of writing an empty build', () => {
  assert.throws(() => parseLoadoutPage('<title>X - Y</title>', URL), /flight payload/)
})

test('build file: names normalized, id default name, bad shapes rejected with the field named', () => {
  const b = parseBuildFile('mine', {
    slots: { FACE: { name: 'Darkbrood Mask +10', exaltations: { focus: 'Polished Mithril Mask (Exaltation)' } } }
  })
  assert.equal(b.name, 'mine')
  assert.deepEqual(b.slots.FACE, { name: 'Darkbrood Mask', exaltations: { focus: 'Polished Mithril Mask' } })
  assert.throws(() => parseBuildFile('x', []), /JSON object/)
  assert.throws(() => parseBuildFile('x', { slots: {}, notes: 'hi' }), /unknown field "notes"/)
  assert.throws(() => parseBuildFile('x', { slots: { CHARM: { name: 'A' } } }), /unknown cell "CHARM"/)
  assert.throws(() => parseBuildFile('x', { slots: { FACE: { name: '' } } }), /slots\.FACE\.name/)
  assert.throws(
    () => parseBuildFile('x', { slots: { FACE: { name: 'A', exaltations: { aug: 'B' } } } }),
    /unknown kind "aug"/
  )
})

test('worn cells: the planner cell assignment, with sockets read by measured index', () => {
  const worn = wornCells(dump)
  assert.deepEqual(worn.FACE, { name: 'Polished Mithril Mask', tier: 3, exaltations: { focus: 'Polished Mithril Mask' } })
  assert.equal(worn.ANY1?.name, 'Brigandine Tunic', 'first Any Slot row')
  assert.equal(worn.ANY2?.name, 'Midnight Clad Straps', 'second Any Slot row')
  assert.equal(worn.FINGER?.name, "Djarn's Amethyst Ring")
  assert.deepEqual(worn.FINGER2?.exaltations, { focus: 'Moonstone Ring' })
  assert.deepEqual(worn.NECK?.exaltations, {}, 'empty sockets are no exaltation')
})

test('compare: different item is a difference, +N and case are not; only named sockets compared', () => {
  const build: Build = {
    id: 'b',
    name: 'b',
    slots: {
      FACE: { name: 'polished mithril mask', exaltations: { focus: 'Polished Mithril Mask', click: 'Guise of the Deceiver' } },
      NECK: { name: 'Amulet of the Void' },
      FINGER2: { name: 'Ring of Pureblood', exaltations: { focus: 'Moonstone Ring' } },
      AMMO: { name: 'Arrow' }
    }
  }
  const rows = compareBuild(build, wornCells(dump))
  assert.deepEqual(
    rows.map((r) => [r.cell, r.differs]),
    [
      ['FACE', false],
      ['NECK', true],
      ['FINGER2', false],
      ['AMMO', true]
    ],
    'PLAN_SLOTS order; only cells the build names'
  )
  const face = rows[0]
  assert.deepEqual(face.exaltations, [
    { kind: 'focus', build: 'Polished Mithril Mask', worn: 'Polished Mithril Mask', differs: false },
    { kind: 'click', build: 'Guise of the Deceiver', differs: true }
  ])
  assert.equal(rows[2].exaltations[0].differs, false)
  assert.equal(rows[3].worn, null, 'nothing worn there')
})

test('source lines: drops then quests; an unknown item has none', () => {
  assert.deepEqual(
    sourceLines({ drops: [{ mob: 'Innoruuk', zone: 'Plane of Hate' }, { mob: 'Fright' }], quests: ['Wizard Test of Focus'] }),
    ['Innoruuk @ Plane of Hate', 'Fright', 'Quest: Wizard Test of Focus']
  )
  assert.deepEqual(sourceLines(null), [])
})
