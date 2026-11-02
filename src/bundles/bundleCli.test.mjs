import test from 'node:test';
import assert from 'node:assert/strict';
import { tileList, tileXY } from '../../scripts/bundle.mjs';

test('tileXY matches the slippy-map scheme', () => {
  assert.deepEqual(tileXY(0, 0, 1), [1, 1]);
  assert.deepEqual(tileXY(-122.0013, 37.0566, 14), [2639, 6373]);
});

test('tileList covers the rectangle at every zoom', () => {
  const list = tileList([-122.25, 36.9, -121.75, 37.25], 6, 8);
  assert.deepEqual([...new Set(list.map(([z]) => z))], [6, 7, 8]);
  assert.ok(list.every(([z, x, y]) => x >= 0 && y >= 0 && x < 2 ** z && y < 2 ** z));
});
