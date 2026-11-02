import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinStore, lockedZoomRange, normalizePin, PIN_STORAGE_KEY } from './pinState.js';

const memoryStorage = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
};

test('normalizePin rejects bad coordinates and fills a label', () => {
  assert.equal(normalizePin({ lat: 91, lon: 0 }), null);
  assert.equal(normalizePin({ lat: 'x', lon: 0 }), null);
  const p = normalizePin({ lat: 37.0566, lon: -122.0013 });
  assert.equal(p.label, '37.05660, -122.00130');
  assert.equal(p.locked, true);
});

test('the pin survives a reload through storage', () => {
  const storage = memoryStorage();
  createPinStore(storage).set({ lat: 37.0566, lon: -122.0013, label: 'Belair Dr', source: 'search' });
  const again = createPinStore(storage).get();
  assert.equal(again.label, 'Belair Dr');
  assert.equal(again.source, 'search');
});

test('lock state is kept when a new pin is set, and clear removes storage', () => {
  const storage = memoryStorage();
  const store = createPinStore(storage);
  store.set({ lat: 1, lon: 2 });
  store.setLocked(false);
  assert.equal(store.set({ lat: 3, lon: 4, source: 'gps' }).locked, false);
  store.clear();
  assert.equal(storage.getItem(PIN_STORAGE_KEY), null);
});

test('corrupt or throwing storage falls back to memory', () => {
  const bad = { getItem: () => '{nope', setItem: () => { throw new Error('quota'); }, removeItem() {} };
  const store = createPinStore(bad);
  assert.equal(store.get(), null);
  assert.equal(store.set({ lat: 1, lon: 1 }).lat, 1);
});

test('subscribers hear every change', () => {
  const seen = [];
  const store = createPinStore(memoryStorage());
  store.subscribe((p) => seen.push(p?.lat ?? null));
  store.set({ lat: 5, lon: 5 });
  store.clear();
  assert.deepEqual(seen, [5, null]);
});

test('locked zoom scales range around the pin and clamps', () => {
  assert.ok(Math.abs(lockedZoomRange(1000, -1) - 1000 / 1.15) < 1e-9);
  assert.equal(lockedZoomRange(1000, 1), 1150);
  assert.equal(lockedZoomRange(31, -1), 30);
  assert.equal(lockedZoomRange(2e7, 1), 2e7);
  assert.equal(lockedZoomRange(NaN, 1), 30);
  assert.equal(lockedZoomRange(500, 0), 500);
});
