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

import { summarizeLexicon } from './geoUnit.js';

test('lexicon summary merges columns into lithology percentages', () => {
  const s = summarizeLexicon(
    { strat_name: 'Purisima', strat_name_long: 'Purisima Formation', rank: 'Fm', strat_name_id: 1667, concept_id: 14197, b_age: '8.342', t_age: '0.6538', b_period: 'Neogene', t_period: 'Neogene' },
    [
      { max_thick: 1725, lith: [{ name: 'sandstone', prop: 0.75 }, { name: 'siltstone', prop: 0.25 }], environ: [{ name: 'marine' }] },
      { max_thick: 300, lith: [{ name: 'sandstone', prop: 0.5 }, { name: 'mudstone', prop: 0.5 }], environ: [{ name: 'shoreface' }] },
    ],
  );
  assert.equal(s.rank, 'Formation');
  assert.equal(s.range, '8.3–0.7 Ma (Neogene)');
  assert.equal(s.maxThicknessM, 1725);
  assert.equal(s.lithology, 'sandstone 63%, mudstone 25%, siltstone 13%');
  assert.equal(s.environments, 'marine, shoreface');
  assert.match(s.conceptUrl, /14197/);
  assert.equal(summarizeLexicon(undefined), null);
});
