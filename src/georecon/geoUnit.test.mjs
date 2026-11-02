import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeUnit, wikiTitles } from './geoUnit.js';

test('Macrostrat unit flattens with an age range', () => {
  const u = summarizeUnit({ name: 'Purisima Formation', strat_name: 'Purisima Formation', b_int_name: 'Late Miocene', t_int_name: 'Pliocene', b_age: 8.3395, t_age: 2.588, color: '#FFFF00', descrip: 'siltstone' });
  assert.equal(u.age, 'Late Miocene – Pliocene (8.3–2.6 Ma)');
  assert.equal(u.strat, '');
  assert.equal(u.color, '#FFFF00');
});

test('bad colors and missing names fall back', () => {
  const u = summarizeUnit({ color: 'red', b_int_name: 'Miocene', t_int_name: 'Miocene' });
  assert.equal(u.name, 'Unnamed unit');
  assert.equal(u.color, '#888888');
  assert.match(u.age, /^Miocene /);
});

test('wiki titles try species then genus', () => {
  assert.deepEqual(wikiTitles('Imagotaria downsi'), ['Imagotaria downsi', 'Imagotaria']);
  assert.deepEqual(wikiTitles('Naticidae'), ['Naticidae']);
});
