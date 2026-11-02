#!/usr/bin/env node
// Data Bundles CLI: list | info <id> | add <id> | remove <id> | enable <id> | disable <id> | rebuild
// Manifests live in bundles/<id>/bundle.json. Installed payloads and the
// generated registry live under public/ (gitignored) so Vite serves them.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLES = join(ROOT, 'bundles');
const STATE = join(BUNDLES, 'state.json'); // { "<id>": { installed, enabled } }
const REGISTRY = join(ROOT, 'public', 'bundles', 'registry.json');

const readJson = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d);
const manifests = () =>
  readdirSync(BUNDLES)
    .filter((d) => existsSync(join(BUNDLES, d, 'bundle.json')))
    .map((d) => readJson(join(BUNDLES, d, 'bundle.json')));
const manifest = (id) => {
  const m = manifests().find((b) => b.id === id);
  if (!m) throw new Error(`Unknown bundle "${id}". Run: npm run bundle -- list`);
  return m;
};
const state = () => readJson(STATE, {});
const saveState = (s) => writeFileSync(STATE, JSON.stringify(s, null, 2) + '\n');
const safeTarget = (to) => {
  const p = resolve(ROOT, to);
  if (!p.startsWith(join(ROOT, 'public') + '/')) throw new Error(`Refusing to write outside public/: ${to}`);
  return p;
};

function rebuild() {
  const s = state();
  const bundles = manifests()
    .filter((m) => s[m.id]?.installed && s[m.id]?.enabled)
    .map(({ id, name, version, license, attribution, home, layers, source }) => {
      const t = source?.tiles;
      const cached = t && existsSync(resolve(ROOT, t.to));
      // Prefer the offline tile cache; zoom past its max falls back to Cesium overzoom.
      const resolved = layers.map((l) =>
        cached && l.id === t.layer ? { ...l, url: `${t.to.replace(/^public\//, '')}/{z}/{x}/{y}.png`, maximumLevel: t.maxZoom, cached: true } : l,
      );
      return { id, name, version, license, attribution, home, layers: resolved };
    });
  mkdirSync(dirname(REGISTRY), { recursive: true });
  writeFileSync(REGISTRY, JSON.stringify({ generatedAt: new Date().toISOString(), bundles }, null, 2) + '\n');
}

async function add(id) {
  const m = manifest(id);
  const src = m.source ?? { type: 'none' };
  for (const f of src.files ?? []) {
    const to = safeTarget(f.to);
    mkdirSync(dirname(to), { recursive: true });
    if (src.type === 'git') {
      writeFileSync(to, execFileSync('git', ['show', `${src.commit}:${f.from}`], { cwd: ROOT, maxBuffer: 1 << 28 }));
    } else if (src.type === 'http') {
      const r = await fetch(f.from);
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${f.from}`);
      writeFileSync(to, Buffer.from(await r.arrayBuffer()));
    }
    console.log(`  + ${f.to}`);
  }
  if (src.tiles) await fetchTiles(id, src.tiles);
  const s = state();
  s[id] = { installed: true, enabled: true, installedAt: new Date().toISOString() };
  saveState(s);
  console.log(`Installed ${id} (${m.license})`);
}

function remove(id) {
  const m = manifest(id);
  if (m.source?.tiles) {
    rmSync(safeTarget(m.source.tiles.to), { recursive: true, force: true });
    console.log(`  - ${m.source.tiles.to}`);
  }
  for (const f of m.source?.files ?? []) {
    const to = safeTarget(f.to);
    rmSync(to, { force: true });
    console.log(`  - ${f.to}`);
  }
  for (const f of m.source?.files ?? []) {
    const d = dirname(safeTarget(f.to));
    if (existsSync(d) && readdirSync(d).length === 0) rmSync(d, { recursive: true });
  }
  const s = state();
  delete s[id];
  saveState(s);
  console.log(`Removed ${id}`);
}

/** Slippy-map tile x/y for lon/lat at zoom z. */
export function tileXY(lon, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return [Math.min(Math.max(x, 0), n - 1), Math.min(Math.max(y, 0), n - 1)];
}

/** Every tile covering rectangle [w,s,e,n] for zooms min..max. */
export function tileList([w, s, e, n], min, max) {
  const out = [];
  for (let z = min; z <= max; z++) {
    const [x0, y0] = tileXY(w, n, z);
    const [x1, y1] = tileXY(e, s, z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([z, x, y]);
  }
  return out;
}

async function fetchTiles(id, t) {
  const list = tileList(t.rectangle, t.minZoom, t.maxZoom);
  if (list.length > (t.maxTiles ?? 5000)) throw new Error(`${list.length} tiles is over the ${t.maxTiles ?? 5000} limit`);
  const root = safeTarget(t.to);
  let done = 0;
  let failed = 0;
  const queue = [...list];
  async function worker() {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const [z, x, y] = job;
      const out = join(root, String(z), String(x), `${y}.png`);
      if (!existsSync(out)) {
        const r = await fetch(t.url.replace('{z}', z).replace('{x}', x).replace('{y}', y), {
          headers: { 'user-agent': 'geo-recon-hub (personal, offline cache)' },
        }).catch(() => null);
        if (r?.ok) {
          mkdirSync(dirname(out), { recursive: true });
          writeFileSync(out, Buffer.from(await r.arrayBuffer()));
        } else failed++;
      }
      if (++done % 100 === 0) console.log(`  tiles ${done}/${list.length}`);
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker)); // polite: 4 at a time
  console.log(`  cached ${list.length - failed}/${list.length} tiles into ${t.to}`);
}

function setEnabled(id, enabled) {
  manifest(id);
  const s = state();
  if (!s[id]?.installed) throw new Error(`${id} is not installed. Run: npm run bundle -- add ${id}`);
  s[id].enabled = enabled;
  saveState(s);
  console.log(`${enabled ? 'Enabled' : 'Disabled'} ${id}`);
}

function dirBytes(p) {
  if (!existsSync(p)) return 0;
  const st = statSync(p);
  return st.isDirectory() ? readdirSync(p).reduce((n, f) => n + dirBytes(join(p, f)), 0) : st.size;
}

function installedBytes(m) {
  const tiles = m.source?.tiles ? dirBytes(resolve(ROOT, m.source.tiles.to)) : 0;
  return tiles + (m.source?.files ?? []).reduce((n, f) => {
    const p = resolve(ROOT, f.to);
    return n + (existsSync(p) ? statSync(p).size : 0);
  }, 0);
}

function list() {
  const s = state();
  for (const m of manifests()) {
    const st = s[m.id];
    const flag = !st?.installed ? 'available' : st.enabled ? 'enabled  ' : 'disabled ';
    const kb = Math.round(installedBytes(m) / 1024);
    console.log(`${flag}  ${m.id.padEnd(32)} ${String(kb).padStart(6)} KB  ${m.license}`);
  }
}

const [cmd, id] = process.argv.slice(2);
if (process.argv[1] !== fileURLToPath(import.meta.url)) {
  // imported by tests: no CLI side effects
} else {
try {
  switch (cmd) {
    case 'list': case undefined: list(); break;
    case 'info': console.log(JSON.stringify(manifest(id), null, 2)); break;
    case 'add': await add(id); break;
    case 'remove': remove(id); break;
    case 'enable': setEnabled(id, true); break;
    case 'disable': setEnabled(id, false); break;
    case 'defaults':
      for (const m of manifests()) if (m.defaultInstalled && !state()[m.id]?.installed) await add(m.id);
      break;
    case 'rebuild': break;
    default: throw new Error(`Unknown command "${cmd}". Use list|info|add|remove|enable|disable|defaults|rebuild`);
  }
  if (cmd && cmd !== 'list' && cmd !== 'info') rebuild();
} catch (e) {
  console.error(`bundle: ${e.message}`);
  process.exit(1);
}
}
