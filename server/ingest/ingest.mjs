#!/usr/bin/env node
// GEO-RECON ingest service: the phone uploads geotagged photos over the LAN.
//   PUT  /api/captures/<uuid>/photo.jpg   (Bearer token, image/jpeg body)
//   PUT  /api/captures/<uuid>/meta.json   (Bearer token, sidecar JSON body)
//   GET  /api/ping                        (Bearer token) -> {ok:true}
//   GET  /pair                            (loopback only) pairing QR page
// Files land in public/bundles/field-captures/, which the hub serves.
// Separate from GEV's own server on purpose: GEV stays loopback-only.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isLanAddress,
  isLoopback,
  isValidId,
  rebuildIndex,
  storePart,
} from './store.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = join(ROOT, 'public', 'bundles', 'field-captures');
const SECRET = join(ROOT, '.georecon', 'ingest.json');
const PORT = Number.parseInt(process.env.INGEST_PORT, 10) || 4180;
const MAX_BYTES = 40 * 1024 * 1024;

function loadToken() {
  if (process.env.INGEST_ROTATE !== '1' && existsSync(SECRET))
    return JSON.parse(readFileSync(SECRET, 'utf8')).token;
  const token = randomBytes(24).toString('base64url');
  mkdirSync(dirname(SECRET), { recursive: true });
  writeFileSync(
    SECRET,
    JSON.stringify({ token, createdAt: new Date().toISOString() }),
    { mode: 0o600 },
  );
  return token;
}
const TOKEN = loadToken();

const lanIp = () =>
  Object.values(networkInterfaces())
    .flat()
    .find(
      (i) => i && i.family === 'IPv4' && !i.internal && isLanAddress(i.address),
    )?.address ?? '127.0.0.1';
const pairUri = () =>
  `georecon://pair?url=${encodeURIComponent(`http://${lanIp()}:${PORT}`)}&token=${TOKEN}`;

function authorized(req) {
  const got = Buffer.from(
    (req.headers.authorization ?? '').replace(/^Bearer /, ''),
  );
  const want = Buffer.from(TOKEN);
  return got.length === want.length && timingSafeEqual(got, want);
}

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

function readBody(req) {
  return new Promise((ok, fail) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > MAX_BYTES) {
        fail(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks)));
    req.on('error', fail);
  });
}

const PAIR_PAGE =
  () => `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Pair GEO-RECON phone</title>
<style>body{background:#040709;color:#3fe0ff;font:15px ui-monospace,Menlo,monospace;display:grid;place-items:center;min-height:100vh;margin:0}
#qr{background:#fff;padding:16px}code{color:#ffb238;word-break:break-all;max-width:480px;display:block}</style>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script></head>
<body><div><h1>PAIR PHONE</h1><p>Scan with the phone camera. It opens GEO-RECON and saves this hub.</p><div id="qr"></div>
<p>No QR? Enter this in the app:</p><code>${pairUri()}</code></div>
<script>try{new QRCode(document.getElementById('qr'),{text:${JSON.stringify(pairUri())},width:280,height:280})}catch(e){document.getElementById('qr').remove()}</script></body></html>`;

const server = createServer(async (req, res) => {
  const addr = req.socket.remoteAddress;
  if (!isLanAddress(addr)) return send(res, 403, { error: 'LAN only' });
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && url.pathname === '/pair') {
      if (!isLoopback(addr))
        return send(res, 403, { error: 'pairing page is loopback only' });
      return send(res, 200, PAIR_PAGE(), 'text/html; charset=utf-8');
    }
    if (!authorized(req))
      return send(res, 401, { error: 'bad or missing token; pair again' });
    if (req.method === 'GET' && url.pathname === '/api/ping')
      return send(res, 200, { ok: true });
    const m = /^\/api\/captures\/([^/]+)\/(photo\.jpg|meta\.json)$/.exec(
      url.pathname,
    );
    if (req.method === 'PUT' && m) {
      if (!isValidId(m[1]))
        return send(res, 400, { error: 'invalid capture id' });
      const count = storePart(DIR, m[1], m[2], await readBody(req));
      return send(res, 200, { ok: true, id: m[1], part: m[2], indexed: count });
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    return send(res, 400, { error: e.message });
  }
});

mkdirSync(DIR, { recursive: true });
rebuildIndex(DIR);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[ingest] listening on LAN port ${PORT} (LAN addresses only)`);
  console.log(
    `[ingest] pair: open http://127.0.0.1:${PORT}/pair on this laptop`,
  );
  console.log(`[ingest] pairing URI: ${pairUri()}`);
});
