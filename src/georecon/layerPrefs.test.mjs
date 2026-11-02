import test from 'node:test';
import assert from 'node:assert/strict';
import { basemapOptions, clampOpacity, getBasemap, getOpacity, setBasemap, setOpacity } from './layerPrefs.js';

const mem = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
};

test('opacity defaults, persists and clamps', () => {
  const s = mem();
  assert.equal(getOpacity(s, 'pbdb-occurrences', 0.25), 0.25);
  setOpacity(s, 'pbdb-occurrences', 0.6);
  assert.equal(getOpacity(s, 'pbdb-occurrences', 0.25), 0.6);
  assert.equal(setOpacity(s, 'x', 7), 1);
  assert.equal(clampOpacity('nope', 0.4), 0.4);
  assert.equal(clampOpacity(-1), 0);
});

test('broken storage falls back to defaults', () => {
  const bad = { getItem: () => '{', setItem: () => { throw new Error('quota'); } };
  assert.equal(getOpacity(bad, 'a', 0.4), 0.4);
  assert.doesNotThrow(() => setOpacity(bad, 'a', 0.5));
});

test('Esri basemaps need a key; keyless options are always available', () => {
  const none = basemapOptions();
  assert.equal(none.find((o) => o.id === 'esri-streets').available, false);
  assert.ok(none.filter((o) => o.available).map((o) => o.id).includes('osm-streets'));
  const keyed = basemapOptions({ arcgisKey: 'abc' });
  assert.match(keyed.find((o) => o.id === 'esri-streets').url, /token=abc/);
});

test('saved basemap is used only while it is available', () => {
  const s = mem();
  setBasemap(s, 'esri-streets');
  assert.equal(getBasemap(s, basemapOptions()), 'gev');
  assert.equal(getBasemap(s, basemapOptions({ arcgisKey: 'k' })), 'esri-streets');
  setBasemap(s, 'carto-dark');
  assert.equal(getBasemap(s, basemapOptions()), 'carto-dark');
});
