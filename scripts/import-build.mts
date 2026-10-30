// import-build.mts — fetch a loadoutlegends.com character page and write it as a build file.
//
//   npx tsx scripts/import-build.mts <url> [--id <file-stem>] [--name "<display name>"] [--dev | --dir <path>]
//
// Writes `<userData>/builds/<id>.json` for the installed app (%APPDATA%\everquest-companion), or the
// `npm run dev` app with --dev. Re-running with the same id overwrites: that is how a build is
// refreshed. The Builds tab picks the file up on its next read (open the tab or press Reload).

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseLoadoutPage } from './builds/loadoutLegends'
import { parseBuildFile } from '../src/shared/builds'

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i === -1 ? undefined : process.argv[i + 1]
}

const url = process.argv[2]
if (url === undefined || !/^https:\/\/(www\.)?loadoutlegends\.com\/characters\//.test(url)) {
  console.error('usage: npx tsx scripts/import-build.mts https://www.loadoutlegends.com/characters/<name-server> [--id x] [--name "x"] [--dev | --dir path]')
  process.exit(1)
}

function buildsDir(): string {
  const explicit = arg('--dir')
  if (explicit !== undefined) return explicit
  const appData = process.env.APPDATA
  if (appData === undefined) throw new Error('APPDATA is not set; pass --dir')
  return join(appData, process.argv.includes('--dev') ? 'everquest-companion-dev' : 'everquest-companion', 'builds')
}
const dir = buildsDir()

const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (everquest-companion build import)' } })
if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
const file = parseLoadoutPage(await res.text(), url)
const name = arg('--name')
if (name !== undefined) file.name = name

/** `tiki-freeport` + `?loadout=MNK/PAL/ENC` → `tiki-freeport-mnk-pal-enc`: one file per loadout. */
function defaultId(): string | undefined {
  const parsed = new URL(url)
  const slug = parsed.pathname.split('/').filter(Boolean).pop()
  const loadout = parsed.searchParams.get('loadout')
  return loadout === null || slug === undefined ? slug : `${slug}-${loadout.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
}
const id = arg('--id') ?? defaultId()
if (id === undefined || !/^[\w.-]+$/.test(id)) throw new Error(`cannot derive a file name from ${url}; pass --id`)
// The app's own validator, so the importer can never write a file the tab would reject.
parseBuildFile(id, file)

mkdirSync(dir, { recursive: true })
const path = join(dir, `${id}.json`)
writeFileSync(path, JSON.stringify(file, null, 2) + '\n')
console.log(`wrote ${path}: "${file.name}", ${Object.keys(file.slots).length} cells`)
