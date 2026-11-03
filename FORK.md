# This fork

`JMFlin/everquest-companion` is a long-lived fork of
[jmoyers/everquest-companion](https://github.com/jmoyers/everquest-companion). It carries the
**Motes** feature (scan, auto rescan, upgrade planner), the **Builds** tab and overlay (with a Farm view: copies to farm per piece for +7 to +10)
([`docs/plans/builds.md`](docs/plans/builds.md)), two additions to the Sky Cleanup tab (a
**Can destroy** count that keeps 3 extra turn-ins' worth, and a table of Sky drops no quest
uses, with class epic pieces kept in and marked on both tables), and the build changes below. These
changes are not headed upstream, so the fork tracks upstream by merging, not by sending PRs.

## Building and installing

```powershell
git fetch upstream
npm run dist:fork
.\release\<version>\everquest-companion-Setup-<version>.exe
```

`dist:fork` ([`scripts/dist-fork.mts`](scripts/dist-fork.mts)) differs from `npm run dist` in
two ways:

- **Auto-update is off.** The upstream updater would treat every upstream release as newer
  and install it over the fork build the next time the app quits. The build sets
  `EQ_NO_AUTO_UPDATE=1`, which compiles the updater out
  ([`src/main/updater.ts`](src/main/updater.ts)). A plain `npm run dist` builds an installer
  that **will** be replaced, so don't install one.
- **The version is `<upstream tag>-fork.<n>`**, for example `1.16.0-fork.42`: the upstream
  release the build is based on, plus the number of fork commits on top. It is stamped into
  the packaged app only. `package.json` stays `0.1.0`, as it does upstream.

## Syncing with upstream

Merge after every upstream release, and in between whenever convenient. Small, frequent
merges keep conflicts small.

```powershell
git switch main
git pull --ff-only
git fetch upstream
git switch -c chore/merge-upstream-<tag>
git merge upstream/main
npm run typecheck; npm run lint; npm test
```

Then open a PR to `main` on this repo, merge it, rebuild with `npm run dist:fork`, and
reinstall. Use merge, not rebase: `main` is published, and a merge resolves each conflict
once.

## Keeping merges cheap

Upstream refactors freely and does not know this fork exists. Conflicts land wherever fork
code edits an upstream file, so:

- **Keep fork code in its own files.** Motes lives under `src/renderer/src/features/motes/`.
  New fork features get their own folder or module in the same way.
- **Edit upstream files only to register fork code**, such as an IPC channel, a nav entry, a
  store key or an overlay kind. Add lines; don't reshape upstream code around them.
- **Leave `package.json`'s version, `AGENTS.md` and upstream's workflows alone.** AGENTS.md has
  a word-count test, and the workflows need upstream's secrets. GitHub Actions is disabled on
  this repo for that reason.
- **Document the fork here**, not in upstream's docs, apart from the one pointer in
  `README.md`.
