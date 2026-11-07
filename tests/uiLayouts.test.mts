// SAVED UI LAYOUTS (fork, src/shared/uiLayouts.ts). Drives the real file work against temp
// directories: save copies only UI_*.ini files, apply backs up the current files before copying
// the layout over them, and a layout name can never escape its store folder.
//
// Run: `npm test`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyUiLayout, deleteUiLayout, listUiLayouts, saveUiLayout } from '../src/main/uiLayouts'
import { isUiLayoutFile, normalizeUiLayoutName } from '../src/shared/uiLayouts'

function setup(): { eq: string; store: string; backup: string } {
  const root = mkdtempSync(join(tmpdir(), 'uilayouts-'))
  const eq = join(root, 'eq')
  mkdirSync(eq)
  writeFileSync(join(eq, 'UI_Aerocell_freeport_LO1.ini'), 'big')
  writeFileSync(join(eq, 'eqclient.ini'), 'client')
  return { eq, store: join(root, 'store'), backup: join(root, 'backup') }
}

test('save copies only UI_*.ini files and lists the layout', () => {
  const { eq, store } = setup()
  saveUiLayout(eq, store, 'Big monitor', 1000)
  assert.deepEqual(listUiLayouts(store), [{ name: 'Big monitor', savedAt: 1000, files: ['UI_Aerocell_freeport_LO1.ini'] }])
})

test('apply backs up the current files, then restores the saved layout', () => {
  const { eq, store, backup } = setup()
  saveUiLayout(eq, store, 'Big monitor', 1000)
  writeFileSync(join(eq, 'UI_Aerocell_freeport_LO1.ini'), 'laptop')
  applyUiLayout(eq, store, 'Big monitor', backup)
  assert.equal(readFileSync(join(eq, 'UI_Aerocell_freeport_LO1.ini'), 'utf8'), 'big')
  assert.equal(readFileSync(join(backup, 'UI_Aerocell_freeport_LO1.ini'), 'utf8'), 'laptop')
  assert.equal(readFileSync(join(eq, 'eqclient.ini'), 'utf8'), 'client')
})

test('saving over a name replaces it, delete removes it', () => {
  const { eq, store } = setup()
  saveUiLayout(eq, store, 'Laptop', 1000)
  saveUiLayout(eq, store, 'Laptop', 2000)
  assert.equal(listUiLayouts(store)[0]?.savedAt, 2000)
  deleteUiLayout(store, 'Laptop')
  assert.deepEqual(readdirSync(store), [])
})

test('save with no UI files and apply of an unknown layout both throw', () => {
  const { store, backup } = setup()
  const empty = mkdtempSync(join(tmpdir(), 'uilayouts-empty-'))
  assert.throws(() => { saveUiLayout(empty, store, 'X', 1) }, /No UI_\*\.ini files/)
  assert.throws(() => { applyUiLayout(empty, store, 'Nope', backup) }, /No saved layout/)
})

test('names are folder-safe; only UI_*.ini counts as a layout file', () => {
  assert.equal(normalizeUiLayoutName('  Big monitor '), 'Big monitor')
  for (const bad of ['', '..', '../x', 'a\\b', 'x'.repeat(33), 42]) assert.equal(normalizeUiLayoutName(bad), null)
  assert.equal(isUiLayoutFile('UI_Char_server.ini'), true)
  assert.equal(isUiLayoutFile('eqclient.ini'), false)
})
