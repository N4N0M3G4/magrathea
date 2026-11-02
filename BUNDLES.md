# Data Bundles (GEO-RECON fork of God's Eye View)

A Data Bundle is an optional pack of data and layers. Install it when you want it; remove it to save disk space and load time. The core app runs with no bundles.

## Layout
- `bundles/<id>/bundle.json`: the manifest (committed).
- `bundles/state.json`: what is installed and enabled on this machine (gitignored).
- `public/bundles/<id>/...`: installed payload files, served at `/bundles/<id>/...` (gitignored).
- `public/bundles/registry.json`: generated list of installed **and** enabled bundles. The browser reads only this.
- `src/bundles/runtime.js`: reads the registry after the Cesium viewer starts, adds each enabled bundle's layers, and shows a small "DATA BUNDLES" panel (bottom left) with a checkbox per layer and a "fly to" button. A missing registry means no bundles.

## Commands
```
npm run bundle -- list              # available / enabled / disabled, size, license
npm run bundle -- info <id>         # print the manifest
npm run bundle -- add <id>          # install payload, enable it
npm run bundle -- remove <id>       # delete payload files and state
npm run bundle -- enable <id>       # keep files, show in the app
npm run bundle -- disable <id>      # keep files, hide from the app
npm run bundle -- defaults          # install every bundle with defaultInstalled: true
npm run bundle -- rebuild           # regenerate registry.json
```
Reload the browser after a change.

## Manifest fields
| Field | Meaning |
|---|---|
| `id`, `name`, `version` | Identity |
| `license`, `attribution` | Shown in the CLI; attribution is added to the Cesium credits |
| `sizeBytes` | Approximate install size |
| `defaultInstalled` | Installed by `defaults` |
| `source.type` | `git` (files from a pinned upstream commit, offline, from local git objects), `http` (download), or `none` (streamed tiles, nothing to store) |
| `source.files[]` | `{from, to}`. `to` must be inside `public/` |
| `source.url` | Human-readable origin |
| `home` | Optional `{lat, lon, label}` for the fly-to button |
| `layers[]` | Layers it registers. `type`: `imagery-xyz` (url, rectangle, alpha, maximumLevel), `points-pbdb` (data path, color), or `core` (only feeds files to a built-in GEV layer) |

To add a new layer kind, add a builder to `BUILDERS` in `src/bundles/runtime.js`.

## Bundles shipped
| id | Default | License | Notes |
|---|---|---|---|
| `geology-scotts-valley` | installed | CC BY 4.0 (Macrostrat); USGS PD | Macrostrat carto tiles over Santa Cruz Mtns. Streamed, not cached. Turning it on also shows Cesium's base globe, because GEV hides it under photorealistic tiles. |
| `pbdb-fossils` | installed | CC BY 4.0 (PBDB) | Snapshot of ~725 occurrences in the box -122.25..-121.75, 36.9..37.25. Re-run `add` to refresh it. |
| `telegeography-submarine-cables` | **not installed** | **CC BY-NC-SA 3.0** | Moved out of `src/data/local_data/`. The built-in Submarine Cables layer now reads `/bundles/telegeography-submarine-cables/`; without the bundle it shows as unavailable. |
| `bhote-koshi-event-pack` | **not installed** | **CC BY-NC 4.0** | Moved out of `public/events/bhote-koshi-2026/`. Without it the Nepal event scene has no imagery. |

## Known gaps
- `src/data/bhoteKoshiFloodPath.js` (CC BY-NC 4.0 derived coordinates) is still compiled into core. Moving it needs the Nepal scene's imports reworked.
- Runtime-fetched non-commercial feeds (OpenSky, S2 GhostMaps, Google News RSS) are not bundled data. They are controlled by GEV's own layer toggles and keys.
- Without `bhote-koshi-event-pack`, about 43 Nepal-scene unit tests fail because they read those files. Install it before running `npm test`.
- When a bundle isn't installed, the Vite dev server answers its URLs with index.html (SPA fallback), not a 404, so the layer fails at JSON parse. It still fails safely.

## Upstream
`git remote -v` shows `upstream` = github.com/bilawalsidhu/gods-eye-view (fetch only; push URL disabled). Work is on branch `geo-recon`. To merge upstream: `git fetch upstream && git merge upstream/main`. Our changes are kept to `bundles/`, `scripts/bundle.mjs`, `src/bundles/`, one line in `src/app/viewer.js`, `src/layers/submarineCables/bundledSource.js` and `server/mcp/services.js`.
