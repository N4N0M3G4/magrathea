// Pure-ish storage and policy helpers for the GEO-RECON ingest service.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

/** Capture ids are UUIDs from the phone; nothing else may reach the disk. */
export const isValidId = (id) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

/** Loopback or RFC 1918 / link-local / IPv6 ULA. Everything else is refused. */
export function isLanAddress(addr = '') {
  const a = addr.replace(/^::ffff:/, '');
  if (a === '127.0.0.1' || a === '::1') return true;
  if (/^10\./.test(a) || /^192\.168\./.test(a) || /^169\.254\./.test(a))
    return true;
  const m = /^172\.(\d+)\./.exec(a);
  if (m && +m[1] >= 16 && +m[1] <= 31) return true;
  return /^f[cd][0-9a-f]{2}:/i.test(a) || /^fe80:/i.test(a);
}

export const isLoopback = (addr = '') =>
  ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(addr);

const META_FIELDS = [
  'id',
  'type',
  'file',
  'timestampMs',
  'lat',
  'lon',
  'altM',
  'hAccM',
  'headingDeg',
  'pitchDeg',
  'rollDeg',
];

/** Validate the phone's sidecar JSON and keep only known fields. */
export function parseMeta(text, id) {
  const raw = JSON.parse(text);
  if (raw.id !== id) throw new Error('meta id does not match URL id');
  const meta = Object.fromEntries(META_FIELDS.map((k) => [k, raw[k] ?? null]));
  for (const k of ['lat', 'lon']) {
    if (meta[k] !== null && !Number.isFinite(meta[k])) meta[k] = null;
  }
  return meta;
}

const isJpeg = (buf) =>
  buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;

/** Store one part. Idempotent: writing the same id again replaces it. */
export function storePart(dir, id, part, body) {
  if (!isValidId(id)) throw new Error('invalid capture id');
  mkdirSync(dir, { recursive: true });
  if (part === 'photo.jpg') {
    if (!isJpeg(body)) throw new Error('photo is not a JPEG');
    writeFileSync(join(dir, `${id}.jpg`), body);
  } else if (part === 'meta.json') {
    const meta = parseMeta(body.toString('utf8'), id);
    writeFileSync(join(dir, `${id}.json`), JSON.stringify(meta));
  } else {
    throw new Error('unknown part');
  }
  return rebuildIndex(dir);
}

/** index.json lists captures that have both a photo and metadata. */
export function rebuildIndex(dir) {
  const captures = readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'index.json')
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))
    .filter((m) => existsSync(join(dir, `${m.id}.jpg`)))
    .map((m) => ({ ...m, photo: `${m.id}.jpg` }))
    .sort((a, b) => (a.timestampMs ?? 0) - (b.timestampMs ?? 0));
  writeFileSync(join(dir, 'index.json'), JSON.stringify({ captures }, null, 1));
  return captures.length;
}
