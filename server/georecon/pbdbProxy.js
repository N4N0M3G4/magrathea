// Same-origin proxy for the Paleobiology Database: PBDB sends no CORS
// headers, so the browser cannot call it directly. Only read-only occurrence,
// collection and taxon queries pass; responses are cached on disk for 7 days.
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const UPSTREAM = 'https://paleobiodb.org/data1.2/';
const ALLOWED = new Set([
  'occs/single.json',
  'occs/list.json',
  'colls/single.json',
  'taxa/single.json',
]);
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

/** Map `/api/georecon/pbdb/<path>?<query>` to the PBDB URL, or null if not allowed. */
export function pbdbUpstreamUrl(pathname, search = '') {
  const m = /^\/api\/georecon\/pbdb\/([a-z]+\/[a-z]+\.json)$/.exec(pathname);
  if (!m || !ALLOWED.has(m[1])) return null;
  const q = new URLSearchParams(search);
  for (const k of q.keys()) if (!/^[a-z_]+$/.test(k)) return null;
  return `${UPSTREAM}${m[1]}?${q.toString()}`;
}

export function georeconPbdbProxyPlugin({
  cacheDir = '.gev-cache/georecon-pbdb',
  fetchImpl = globalThis.fetch,
} = {}) {
  return {
    name: 'georecon-pbdb-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/georecon/pbdb/')) return next();
        const u = new URL(req.url, 'http://x');
        const upstream = pbdbUpstreamUrl(u.pathname, u.search);
        if (!upstream || req.method !== 'GET') {
          res.statusCode = 400;
          return res.end('{"error":"query not allowed"}');
        }
        mkdirSync(cacheDir, { recursive: true });
        const file = join(
          cacheDir,
          `${createHash('sha256').update(upstream).digest('hex').slice(0, 32)}.json`,
        );
        res.setHeader('content-type', 'application/json');
        if (
          existsSync(file) &&
          Date.now() - statSync(file).mtimeMs < MAX_AGE_MS
        )
          return res.end(readFileSync(file));
        try {
          const r = await fetchImpl(upstream, {
            headers: { 'user-agent': 'geo-recon-hub (personal)' },
          });
          const body = Buffer.from(await r.arrayBuffer());
          if (r.ok) writeFileSync(file, body);
          res.statusCode = r.status;
          res.end(body);
        } catch {
          res.statusCode = 502;
          res.end('{"error":"PBDB unreachable"}');
        }
      });
    },
  };
}
