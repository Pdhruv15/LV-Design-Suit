# Electron licence files in the Mac package — decision needed

Found on 2026-11-01 while removing `node_modules` from the package. Nothing is changed yet.

| Package | `LICENSE.electron.txt` and `LICENSES.chromium.html` |
|---|---|
| Windows, Linux | next to the app |
| Mac | not in the `.app` |

The Mac app already lacked them before that work: Electron is a development dependency, so it never came with `node_modules`, and electron-builder leaves both files out of the Mac app. The libraries compiled into the app are covered by `third-party-licences.md` in `dist` and `dist-electron` (see `NOTICE.md`).

**Decision for the user:** should the Mac app carry them? `mac.extraResources` can copy them in. `LICENSES.chromium.html` adds 19.53 MB to the 252.54 MB app (2.03 MB when gzipped), and the Electron licence file about 1 KB.

Up: [[Future development]]
