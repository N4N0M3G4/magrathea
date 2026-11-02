import test from 'node:test';
import assert from 'node:assert/strict';
import { pbdbUpstreamUrl } from './pbdbProxy.js';

test('only allowlisted PBDB read endpoints are proxied', () => {
  assert.equal(
    pbdbUpstreamUrl('/api/georecon/pbdb/occs/single.json', '?id=occ:1&show=full'),
    'https://paleobiodb.org/data1.2/occs/single.json?id=occ%3A1&show=full',
  );
  assert.equal(pbdbUpstreamUrl('/api/georecon/pbdb/occs/delete.json', ''), null);
  assert.equal(pbdbUpstreamUrl('/api/georecon/pbdb/../x.json', ''), null);
  assert.equal(pbdbUpstreamUrl('/api/georecon/pbdb/occs/list.json', '?bad-key=1'), null);
});
