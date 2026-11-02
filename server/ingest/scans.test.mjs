import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseScanPath, storeScanPart } from './scans.mjs';

const ID = '1b9f3f4e-3b7a-4c55-9a51-6a2f0c1d2e3f';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1]);

test('scan routes accept only spec paths with a UUID', () => {
  assert.deepEqual(parseScanPath(`/api/scans/${ID}/frames/000012.jpg`), { id: ID, part: 'frames/000012.jpg' });
  assert.deepEqual(parseScanPath(`/api/scans/${ID}/complete`), { id: ID, part: 'complete' });
  assert.equal(parseScanPath(`/api/scans/${ID}/frames/12.jpg`), null);
  assert.equal(parseScanPath('/api/scans/../frames/000001.jpg'), null);
});

test('frames are idempotent and the index tracks status', () => {
  const root = mkdtempSync(join(tmpdir(), 'scans-'));
  storeScanPart(root, ID, 'session.json', Buffer.from(JSON.stringify({ id: ID, taxonGuess: 'oyster', createdMs: 1 })));
  assert.equal(storeScanPart(root, ID, 'frames/000001.jpg', JPEG), 1);
  assert.equal(storeScanPart(root, ID, 'frames/000001.jpg', JPEG), 1);
  storeScanPart(root, ID, 'frames/000001.json', Buffer.from('{"frame":1}'));
  let idx = JSON.parse(readFileSync(join(root, 'index.json'), 'utf8'));
  assert.equal(idx.sessions[0].status, 'uploading');
  storeScanPart(root, ID, 'complete', Buffer.alloc(0));
  idx = JSON.parse(readFileSync(join(root, 'index.json'), 'utf8'));
  assert.deepEqual([idx.sessions[0].status, idx.sessions[0].frames, idx.sessions[0].label], ['complete', 1, 'oyster']);
});

test('bad parts are refused', () => {
  const root = mkdtempSync(join(tmpdir(), 'scans-'));
  assert.throws(() => storeScanPart(root, ID, 'frames/000001.jpg', Buffer.from('nope')), /not a JPEG/);
  assert.throws(() => storeScanPart(root, ID, 'session.json', Buffer.from('{"id":"other"}')), /does not match/);
  assert.throws(() => storeScanPart(root, ID, 'frames/000001.json', Buffer.from('{bad')));
});
