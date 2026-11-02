import test from 'node:test';
import assert from 'node:assert/strict';
import { commonGroup, gbifImages, shortLicense, summarizeOccurrence } from './fossilInfo.js';

const rec = {
  occurrence_no: '297784', collection_no: '13062', identified_name: 'Imagotaria downsi',
  accepted_name: 'Imagotaria downsi', accepted_rank: 'species', accepted_no: '71875',
  early_interval: 'Tortonian', max_ma: 11.63, min_ma: 7.246, phylum: 'Chordata', class: 'Mammalia',
  order: 'Carnivora', family: 'Odobenidae', formation: 'Santa Margarita', lithology1: 'sandstone',
  environment: 'marine indet.', collection_name: 'UCMP V-70184, Granite Rock Company quarry',
  county: 'Santa Cruz', state: 'California', latlng_precision: 'seconds', geogscale: 'outcrop',
  ref_author: 'Repenning and Tedford', ref_pubyr: '1977',
};

test('a PBDB occurrence flattens to the modal fields', () => {
  const s = summarizeOccurrence(rec);
  assert.equal(s.taxon, 'Imagotaria downsi');
  assert.equal(s.group, 'mammal');
  assert.equal(s.age, 'Tortonian (11.6–7.2 Ma)');
  assert.equal(s.formation, 'Santa Margarita');
  assert.equal(s.reference, 'Repenning and Tedford 1977');
  assert.match(s.pbdbUrl, /collection_no=13062/);
  assert.equal(s.identifiedAs, '');
});

test('missing fields read as not recorded, never undefined', () => {
  const s = summarizeOccurrence({ occurrence_no: '1', collection_no: '2' });
  assert.equal(s.formation, 'not recorded');
  assert.match(s.age, /unknown interval/);
  assert.equal(commonGroup({ phylum: 'Mollusca', class: 'Bivalvia' }), 'clam, oyster or scallop');
});

test('GBIF images prefer California, keep credits, skip non-https', () => {
  const imgs = gbifImages([
    { key: 1, stateProvince: 'Oregon', media: [{ type: 'StillImage', identifier: 'https://a/1.jpg', license: 'CC-BY', rightsHolder: 'X' }] },
    { key: 2, stateProvince: 'California', media: [{ type: 'StillImage', identifier: 'https://a/2.jpg' }], institutionCode: 'UCMP', license: 'CC0' },
    { key: 3, media: [{ type: 'StillImage', identifier: 'http://insecure/3.jpg' }] },
  ]);
  assert.deepEqual(imgs.map((i) => i.link.split('/').pop()), ['2', '1']);
  assert.equal(imgs[0].credit, 'UCMP');
  assert.equal(imgs[0].license, 'CC0');
});

test('licenses are shortened for captions', () => {
  assert.equal(shortLicense('http://creativecommons.org/licenses/by-sa/4.0/'), 'CC BY-SA 4.0');
  assert.equal(shortLicense('https://creativecommons.org/publicdomain/zero/1.0/'), 'CC0');
  assert.equal(shortLicense(''), 'license unknown');
});
