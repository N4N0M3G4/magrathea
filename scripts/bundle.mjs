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
    .map(({ id, name, version, license, attribution, home, layers }) => ({ id, name, version, license, attribution, home, layers }));
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
  const s = state();
  s[id] = { installed: true, enabled: true, installedAt: new Date().toISOString() };
  saveState(s);
  console.log(`Installed ${id} (${m.license})`);
}

function remove(id) {
  const m = manifest(id);
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

function setEnabled(id, enabled) {
  manifest(id);
  const s = state();
  if (!s[id]?.installed) throw new Error(`${id} is not installed. Run: npm run bundle -- add ${id}`);
  s[id].enabled = enabled;
  saveState(s);
  console.log(`${enabled ? 'Enabled' : 'Disabled'} ${id}`);
}

function installedBytes(m) {
  return (m.source?.files ?? []).reduce((n, f) => {
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
