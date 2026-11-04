import assert from 'node:assert/strict';
import test from 'node:test';
import { matchModel } from './fossil3dBundle.js';

const models = [
  { id: 'oyster', match: 'Ostreidae|Crassostrea|Ostrea' },
  { id: 'bad', match: '(' },
];

test('an oyster genus matches the oyster model', () => {
  assert.equal(
    matchModel(models, { taxon: 'Crassostrea titan' })?.id,
    'oyster',
  );
});

test('the family in the lineage is enough', () => {
  const info = {
    taxon: 'Saccostrea sp.',
    lineage: 'Mollusca › Bivalvia › Ostreida › Ostreidae',
  };
  assert.equal(matchModel(models, info)?.id, 'oyster');
});

test('other fossils get no model, and a bad regex is skipped', () => {
  assert.equal(
    matchModel(models, { taxon: 'Balanus', lineage: 'Arthropoda' }),
    null,
  );
  assert.equal(matchModel(undefined, { taxon: 'Ostrea' }), null);
});
