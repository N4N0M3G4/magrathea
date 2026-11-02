// Object-scan sessions (fossil3d/CAPTURE-SPEC.md section 6). Stored under
// public/bundles/object-scans/<sessionId>/{session.json, frames/NNNNNN.jpg|json, complete}.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { isValidId } from './store.mjs';

const isJpeg = (b) =>
  b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/** Parse a scan route: {id, part} where part is session.json | frames/NNNNNN.(jpg|json) | complete. */
export function parseScanPath(pathname) {
  const m =
    /^\/api\/scans\/([^/]+)\/(session\.json|frames\/\d{6}\.(?:jpg|json)|complete)$/.exec(
      pathname,
    );
  if (!m || !isValidId(m[1])) return null;
  return { id: m[1], part: m[2] };
}

/** Store one part; idempotent (same path overwrites). Returns the session's frame count. */
export function storeScanPart(root, id, part, body) {
  const dir = join(root, id);
  mkdirSync(join(dir, 'frames'), { recursive: true });
  if (part === 'complete') {
    writeFileSync(join(dir, 'complete'), String(Date.now()));
  } else if (part.endsWith('.jpg')) {
    if (!isJpeg(body)) throw new Error('frame is not a JPEG');
    writeFileSync(join(dir, part), body);
  } else {
    const json = JSON.parse(body.toString('utf8')); // must parse
    if (part === 'session.json' && json.id !== id)
      throw new Error('session id does not match URL id');
    writeFileSync(join(dir, part), JSON.stringify(json));
  }
  rebuildScanIndex(root);
  return countFrames(dir);
}

const countFrames = (dir) =>
  existsSync(join(dir, 'frames'))
    ? readdirSync(join(dir, 'frames')).filter((f) => f.endsWith('.jpg')).length
    : 0;

/** index.json lists sessions with status uploading|complete and frame counts. */
export function rebuildScanIndex(root) {
  mkdirSync(root, { recursive: true });
  const sessions = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && isValidId(d.name))
    .map((d) => {
      const dir = join(root, d.name);
      let session = null;
      try {
        session = JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8'));
      } catch {
        /* not yet uploaded */
      }
      return {
        id: d.name,
        status: existsSync(join(dir, 'complete')) ? 'complete' : 'uploading',
        frames: countFrames(dir),
        label: session?.taxonGuess ?? '',
        lat: session?.lat ?? null,
        lon: session?.lon ?? null,
        createdMs: session?.createdMs ?? null,
      };
    })
    .sort((a, b) => (a.createdMs ?? 0) - (b.createdMs ?? 0));
  writeFileSync(
    join(root, 'index.json'),
    JSON.stringify({ sessions }, null, 1),
  );
  return sessions;
}
