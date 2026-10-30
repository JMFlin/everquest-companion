// GEAR BUILDS — the build file format, the worn cells, the comparison, and the loadoutlegends import.
//
// Two real fixtures: the dev character's committed dump (`Primitive_freeport-Inventory.txt`) for
// what is worn, and a saved loadoutlegends.com character page (`loadoutlegends-larlen.html`) for
// the importer — a third-party page, so the parser is only ever exercised against this copy.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  compareBuild,
  parseBuildFile,
  sourceLines,
  wornCells,
  wornFor,
  type Build,
  type BuildsPayload
} from '../src/shared/builds'
import { archiveWornLoadout, readWornLoadouts, selfWhoNear } from '../src/main/wornLoadouts'
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

test('import: an ornamentation socket is cosmetic and skipped, not an unknown socket', () => {
  const file = parseLoadoutPage(readFileSync(join(fixtures, 'loadoutlegends-tiki.html'), 'utf8'), URL)
  assert.equal(file.name, 'Tiki (MNK/PAL/ENC)')
  assert.equal(file.classes, 'MNK/PAL/ENC')
  assert.equal(parseBuildFile('tiki', file).classes, 'ENC/MNK/PAL', 'a loadout is its class set')
  assert.ok(Object.keys(file.slots).length > 0)
  const kinds = Object.values(file.slots).flatMap((s) => Object.keys(s.exaltations ?? {}))
  assert.ok(!kinds.includes('ornamentation'))
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
  assert.deepEqual(worn.FACE, {
    name: 'Polished Mithril Mask',
    tier: 3,
    exaltations: { focus: 'Polished Mithril Mask' }
  })
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
      FACE: {
        name: 'polished mithril mask',
        exaltations: { focus: 'Polished Mithril Mask', click: 'Guise of the Deceiver' }
      },
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
    sourceLines({
      drops: [{ mob: 'Innoruuk', zone: 'Plane of Hate' }, { mob: 'Fright' }],
      quests: ['Wizard Test of Focus']
    }),
    ['Innoruuk @ Plane of Hate', 'Fright', 'Quest: Wizard Test of Focus']
  )
  assert.deepEqual(sourceLines(null), [])
})

test('build file: classes validated as 1-3 distinct /who codes', () => {
  assert.equal(parseBuildFile('x', { classes: 'pal/mnk/enc', slots: {} }).classes, 'ENC/MNK/PAL')
  assert.throws(() => parseBuildFile('x', { classes: 'PAL/SHK', slots: {} }), /unknown class "SHK"/)
  assert.throws(() => parseBuildFile('x', { classes: 'PAL/PAL', slots: {} }), /distinct/)
  assert.throws(() => parseBuildFile('x', { classes: 'PAL/MNK/ENC/WAR', slots: {} }), /distinct/)
})

test('compare target: auto picks the build loadout copy, newest the latest dump, a key that copy', () => {
  const newest = { loadedAt: '2026-10-30T10:00:00.000Z', classes: 'BST/ENC/SHM', cells: {} }
  const pal = { loadedAt: '2026-10-29T10:00:00.000Z', classes: 'ENC/MNK/PAL', cells: {} }
  const payload = { worn: newest, loadouts: { 'BST/ENC/SHM': newest, 'ENC/MNK/PAL': pal } } as unknown as BuildsPayload
  const forPal: Build = { id: 'p', name: 'p', classes: 'ENC/MNK/PAL', slots: {} }
  const any: Build = { id: 'a', name: 'a', slots: {} }
  assert.equal(wornFor(payload, forPal, 'auto'), pal)
  assert.equal(wornFor(payload, any, 'auto'), newest)
  assert.equal(wornFor(payload, forPal, 'newest'), newest)
  assert.equal(wornFor(payload, any, 'ENC/MNK/PAL'), pal)
  assert.equal(
    wornFor(payload, { ...forPal, classes: 'CLR/WAR' }, 'auto'),
    null,
    'no copy yet → nothing, not the newest'
  )
})

const WHO =
  '[Thu Oct 29 21:00:00 2026] [50 PAL/MNK/ENC] Aerocell (Iksar) <Banished Brigade> ZONE: East Freeport (freporte)  '
const LOG = [
  '[Thu Oct 29 20:00:00 2026] [50 BST/SHM/ENC] Aerocell (Iksar)  ZONE: East Freeport (freporte)  ',
  '[Thu Oct 29 21:00:00 2026] [50 WAR/CLR/ENC] Stranger (Human)  ZONE: East Freeport (freporte)  ',
  WHO,
  '[Thu Oct 29 21:00:01 2026] There are 2 players in East Freeport.'
].join('\n')
const at = (s: string): number => {
  const [h, m, sec] = s.split(':').map(Number)
  return new Date(2026, 9, 29, h, m, sec).getTime()
}

test('pairing: the own /who row nearest the dump within a minute, either side; strangers ignored', () => {
  assert.deepEqual(selfWhoNear(LOG, 'Aerocell', at('21:00:30')), ['PAL', 'MNK', 'ENC'])
  assert.deepEqual(selfWhoNear(LOG, 'Aerocell', at('20:59:10')), ['PAL', 'MNK', 'ENC'], '/who after the dump')
  assert.deepEqual(selfWhoNear(LOG, 'Aerocell', at('20:00:20')), ['BST', 'SHM', 'ENC'])
  assert.equal(selfWhoNear(LOG, 'Aerocell', at('21:05:00')), null, 'no /who near the dump: not filed')
  assert.equal(selfWhoNear(LOG, 'Stranger2', at('21:00:00')), null)
})

test('archive: a paired dump is filed under its loadout; other loadouts survive', () => {
  const dir = mkdtempSync(join(tmpdir(), 'worn-'))
  const logPath = join(dir, 'eqlog.txt')
  writeFileSync(logPath, LOG)
  const character = { name: 'Aerocell', server: 'freeport', logPath }
  const iso = (s: string): string => new Date(at(s)).toISOString()
  const cells = { NECK: { name: 'Amulet', exaltations: {} } }
  assert.equal(archiveWornLoadout(dir, character, { loadedAt: iso('20:00:10'), cells }), 'BST/ENC/SHM')
  assert.equal(archiveWornLoadout(dir, character, { loadedAt: iso('21:00:10'), cells: {} }), 'ENC/MNK/PAL')
  assert.equal(archiveWornLoadout(dir, character, { loadedAt: iso('22:00:00'), cells: {} }), null)
  const saved = readWornLoadouts(dir, character)
  assert.deepEqual(Object.keys(saved).sort(), ['BST/ENC/SHM', 'ENC/MNK/PAL'])
  assert.deepEqual(saved['BST/ENC/SHM'].cells, cells, 'the other loadout survives')
})
