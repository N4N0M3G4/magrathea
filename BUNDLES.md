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
| `source.type` | `git` (files from a pinned upstream commit, offline, from local git objects), `local` (files committed in this repo), `http` (download), or `none` (streamed tiles, nothing to store) |
| `source.files[]` | `{from, to}`. `to` must be inside `public/` |
| `source.url` | Human-readable origin |
| `home` | Optional `{lat, lon, label}` for the fly-to button |
| `layers[]` | Layers it registers. `type`: `imagery-xyz` (url, rectangle, alpha, maximumLevel), `points-pbdb` (data path, color), `captures`, `fossil3d` (models matched to fossil pop-ups, no map layer), or `core` (only feeds files to a built-in GEV layer) |

To add a new layer kind, add a builder to `BUILDERS` in `src/bundles/runtime.js`.

## Bundles shipped
| id | Default | License | Notes |
|---|---|---|---|
| `geology-scotts-valley` | installed | CC BY 4.0 (Macrostrat); USGS PD | Macrostrat carto tiles over Santa Cruz Mtns. `add` caches zoom 6-14 offline (693 tiles, about 32 MB, 4 requests at a time); the registry then points the layer at the cache. Turning it on also shows Cesium's base globe, because GEV hides it under photorealistic tiles. |
| `pbdb-fossils` | installed | CC BY 4.0 (PBDB) | Snapshot of ~725 occurrences in the box -122.25..-121.75, 36.9..37.25. Re-run `add` to refresh it. |
| `field-captures` | installed | your photos | Photos uploaded from the phone by the ingest service (below). Amber pins with a 25 m heading cone; click one to see the photo. The map re-reads the photo list every 10 s. |
| `fossil3d` | installed | CC0 (Smithsonian Open Access) | 3D oyster reference (*Ostrea denselamellosa*) and a synthetic demo hinge fragment, committed under `bundles/fossil3d/payload/` (`source.type: local`). Oyster pop-ups (match `Ostreidae|Crassostrea|Ostrea`) show the 3D view; three.js loads only then. |
| `telegeography-submarine-cables` | **not installed** | **CC BY-NC-SA 3.0** | Moved out of `src/data/local_data/`. The built-in Submarine Cables layer now reads `/bundles/telegeography-submarine-cables/`; without the bundle it shows as unavailable. |
| `bhote-koshi-event-pack` | **not installed** | **CC BY-NC 4.0** | Moved out of `public/events/bhote-koshi-2026/`. Without it the Nepal event scene has no imagery. |

## Known gaps
- `src/data/bhoteKoshiFloodPath.js` (CC BY-NC 4.0 derived coordinates) is still compiled into core. Moving it needs the Nepal scene's imports reworked.
- Runtime-fetched non-commercial feeds (OpenSky, S2 GhostMaps, Google News RSS) are not bundled data. They are controlled by GEV's own layer toggles and keys.
- Tests that read an optional bundle's files skip cleanly when it is missing (`src/bundles/testing.mjs`: `needsBundle`, `gateOnBundle`). With default bundles: 9043 pass, 95 skipped, 0 fail. With all bundles installed, nothing is skipped.
- When a bundle isn't installed, the Vite dev server answers its URLs with index.html (SPA fallback), not a 404, so the layer fails at JSON parse. It still fails safely.

## Upstream
`git remote -v` shows `upstream` = github.com/bilawalsidhu/gods-eye-view (fetch only; push URL disabled). Work is on branch `geo-recon`. To merge upstream: `git fetch upstream && git merge upstream/main`. Our changes are kept to `bundles/`, `scripts/bundle.mjs`, `src/bundles/`, one line in `src/app/viewer.js`, `src/layers/submarineCables/bundledSource.js` and `server/mcp/services.js`.

## Phone upload (ingest service)
`npm run ingest` starts a small server on LAN port 4180 (`INGEST_PORT` to change), separate from GEV, which stays loopback-only.
- **Pairing:** open http://127.0.0.1:4180/pair on the laptop and scan the QR with the phone camera. It opens `georecon://pair?url=...&token=...` in the app. The token is in `.georecon/ingest.json` (gitignored); `INGEST_ROTATE=1 npm run ingest` makes a new one, so you have to pair again.
- **Upload:** `PUT /api/captures/<uuid>/photo.jpg` (JPEG body) and `PUT /api/captures/<uuid>/meta.json` (the phone's sidecar JSON). Both need `Authorization: Bearer <token>`. PUT by capture id is idempotent; a retry overwrites.
- **Guards:** only LAN/loopback client addresses are accepted, the id must be a UUID, the photo must be a JPEG (40 MB max), and only known metadata fields are kept.
- **Storage:** `public/bundles/field-captures/<id>.jpg|json` plus `index.json`. Only captures with both parts appear on the map.
- **Phone side** (`app/`): a WorkManager job uploads captures without an `<id>.uploaded` marker when the phone is on unmetered Wi-Fi. It runs after each capture and at app start.
