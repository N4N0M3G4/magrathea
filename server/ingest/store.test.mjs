import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isLanAddress, isValidId, parseMeta, storePart } from './store.mjs';

const ID = '0b9f3f4e-3b7a-4c55-9a51-6a2f0c1d2e3f';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const meta = (extra = {}) =>
  Buffer.from(JSON.stringify({ id: ID, type: 'photo', file: `${ID}.jpg`, timestampMs: 1, lat: 37.05699, lon: -122.00035, headingDeg: 99, ...extra }));

test('only LAN and loopback addresses are accepted', () => {
  for (const ok of ['127.0.0.1', '::1', '192.168.86.28', '10.0.0.5', '172.20.1.1', '::ffff:192.168.1.2', 'fd12::1'])
    assert.equal(isLanAddress(ok), true, ok);
  for (const bad of ['8.8.8.8', '172.32.0.1', '100.64.0.1', '', '2001:db8::1'])
    assert.equal(isLanAddress(bad), false, bad);
});

test('capture ids must be UUIDs, so paths cannot escape', () => {
  assert.equal(isValidId(ID), true);
  assert.equal(isValidId('../../etc/passwd'), false);
});

test('meta must match the URL id and keeps only known fields', () => {
  assert.throws(() => parseMeta(meta().toString(), 'other'), /does not match/);
  const m = parseMeta(meta({ evil: 1, lat: 'x' }).toString(), ID);
  assert.equal('evil' in m, false);
  assert.equal(m.lat, null);
});

test('uploads are idempotent by capture id and indexed once both parts exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ingest-'));
  assert.equal(storePart(dir, ID, 'meta.json', meta()), 0);
  assert.equal(storePart(dir, ID, 'photo.jpg', JPEG), 1);
  assert.equal(storePart(dir, ID, 'photo.jpg', JPEG), 1);
  assert.equal(storePart(dir, ID, 'meta.json', meta({ headingDeg: 120 })), 1);
  const idx = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
  assert.equal(idx.captures.length, 1);
  assert.equal(idx.captures[0].headingDeg, 120);
  assert.deepEqual(readdirSync(dir).sort(), [`${ID}.jpg`, `${ID}.json`, 'index.json']);
});

test('non-JPEG photos are refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ingest-'));
  assert.throws(() => storePart(dir, ID, 'photo.jpg', Buffer.from('hello')), /not a JPEG/);
});
