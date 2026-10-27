/**
 * dist-fork.mts — the installer for this fork (JMFlin/everquest-companion). See FORK.md.
 *
 * `npm run dist:fork`. The same chain as `npm run dist`, with two differences that keep a fork
 * build from being replaced by the upstream release it diverged from:
 *
 *   - EQ_NO_AUTO_UPDATE=1 bakes the updater off (src/main/updater.ts), so an upstream release is
 *     never downloaded and installed over this build on quit.
 *   - The version is `<upstream tag>-fork.<commits ahead of upstream>` (e.g. 1.16.0-fork.42),
 *     stamped into the packaged app only, the way CI stamps a tag: package.json stays 0.1.0, so
 *     merging upstream never conflicts on it.
 *
 * Needs the `upstream` remote; run `git fetch upstream` first so the tag is current.
 */
import { execFileSync } from 'node:child_process'

const git = (...args: string[]): string => execFileSync('git', args, { encoding: 'utf8' }).trim()

const run = (command: string): void => {
  execFileSync(command, {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, EQ_NO_AUTO_UPDATE: '1' }
  })
}

const tag = git('describe', '--tags', '--abbrev=0', '--match', 'v*', 'upstream/main')
const ahead = git('rev-list', '--count', 'upstream/main..HEAD')
const version = `${tag.replace(/^v/, '')}-fork.${ahead}`

console.log(`[dist:fork] building ${version}`)
run('npm run build')
run('npm run build:engine')
run(`npx electron-builder --win -c.extraMetadata.version=${version}`)
