// Fossil occurrence details for the GEO-RECON modal. Pure helpers plus a
// lazy, cached loader (PBDB via the hub proxy, PhyloPic and GBIF directly).

const cache = new Map();

/** Common-group label from PBDB classification (most specific known). */
export function commonGroup(r) {
  const groups = {
    Mammalia: 'mammal',
    Aves: 'bird',
    Reptilia: 'reptile',
    Chondrichthyes: 'shark or ray',
    Actinopterygii: 'ray-finned fish',
    Bivalvia: 'clam, oyster or scallop',
    Gastropoda: 'snail',
    Echinoidea: 'sea urchin or sand dollar',
    Anthozoa: 'coral',
    Cephalopoda: 'cephalopod',
    Foraminifera: 'foraminifer',
    Brachiopoda: 'brachiopod',
    Malacostraca: 'crab or shrimp',
    Magnoliopsida: 'flowering plant',
    Pinopsida: 'conifer',
  };
  return (
    groups[r.class] ??
    groups[r.phylum] ??
    (r.class || r.phylum || 'unknown group')
  );
}

/** "http://creativecommons.org/licenses/by-sa/4.0/" -> "CC BY-SA 4.0". */
export function shortLicense(l = '') {
  const s = String(l);
  if (/publicdomain\/zero/i.test(s)) return 'CC0';
  const m = /licenses\/([a-z-]+)\/([\d.]+)/i.exec(s);
  if (m) return `CC ${m[1].toUpperCase()} ${m[2]}`;
  return s.replace(/^https?:\/\//, '').slice(0, 40) || 'license unknown';
}

const ma = (v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(1) : '?');

/** Flatten a PBDB `occs/single` record (vocab=pbdb, show=full) for display. */
export function summarizeOccurrence(r) {
  const interval =
    [r.early_interval, r.late_interval].filter(Boolean).join(' – ') ||
    'unknown interval';
  return {
    oid: r.occurrence_no,
    cid: r.collection_no,
    taxon: r.accepted_name || r.identified_name || 'unidentified',
    rank: r.accepted_rank || r.identified_rank || '',
    identifiedAs:
      r.identified_name && r.identified_name !== r.accepted_name
        ? r.identified_name
        : '',
    taxonNo: r.accepted_no || '',
    group: commonGroup(r),
    lineage: [r.phylum, r.class, r.order, r.family].filter(Boolean).join(' › '),
    age: `${interval} (${ma(r.max_ma)}–${ma(r.min_ma)} Ma)`,
    formation:
      [r.formation, r.member && `${r.member} Mbr`].filter(Boolean).join(', ') ||
      'not recorded',
    lithology:
      [r.lithology1, r.lithology2].filter(Boolean).join(', ') || 'not recorded',
    environment: r.environment || 'not recorded',
    collection: `${r.collection_name || 'collection'} (PBDB ${r.collection_no})`,
    place: [r.county && `${r.county} Co.`, r.state].filter(Boolean).join(', '),
    precision:
      [r.latlng_precision, r.geogscale].filter(Boolean).join(', ') || 'unknown',
    reference: r.ref_author
      ? `${r.ref_author} ${r.ref_pubyr ?? ''}`.trim()
      : r.primary_reference || '',
    pbdbUrl: `https://paleobiodb.org/classic/basicCollectionSearch?collection_no=${r.collection_no}`,
    occUrl: `https://paleobiodb.org/classic/displayOccurrence?occurrence_no=${r.occurrence_no}`,
  };
}

/** Pick up to `n` images from GBIF occurrence results, CA first, with credits. */
export function gbifImages(results, n = 4) {
  const out = [];
  const ranked = [...(results ?? [])].sort(
    (a, b) =>
      Number(b.stateProvince === 'California') -
      Number(a.stateProvince === 'California'),
  );
  for (const occ of ranked) {
    for (const m of occ.media ?? []) {
      if (m.type !== 'StillImage' || !m.identifier?.startsWith('https://'))
        continue;
      out.push({
        src: m.identifier,
        credit:
          m.rightsHolder ||
          m.creator ||
          occ.institutionCode ||
          occ.datasetName ||
          'GBIF publisher',
        license: shortLicense(m.license || occ.license || 'see GBIF record'),
        where: [occ.stateProvince, occ.country].filter(Boolean).join(', '),
        link: `https://www.gbif.org/occurrence/${occ.key}`,
      });
      break; // one image per specimen
    }
    if (out.length >= n) break;
  }
  return out;
}

async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** Load (and cache) everything the modal shows for one occurrence. */
export function loadFossilDetails(oid, base = '/') {
  const id = String(oid).replace(/^occ:/, '');
  if (!cache.has(id))
    cache.set(
      id,
      (async () => {
        const occ = await json(
          `${base}api/georecon/pbdb/occs/single.json?id=occ:${id}&show=full&vocab=pbdb`,
        );
        const info = summarizeOccurrence(occ.records?.[0] ?? {});
        const [phylopic, gbif] = await Promise.allSettled([
          info.taxonNo
            ? json(
                `https://api.phylopic.org/resolve/paleobiodb.org/txn/${info.taxonNo}?embed_primaryImage=true`,
              )
            : Promise.reject(new Error('no taxon')),
          json(
            `https://api.gbif.org/v1/occurrence/search?scientificName=${encodeURIComponent(info.taxon)}&mediaType=StillImage&basisOfRecord=FOSSIL_SPECIMEN&limit=20`,
          ),
        ]);
        const pi =
          phylopic.status === 'fulfilled'
            ? phylopic.value?._embedded?.primaryImage
            : null;
        info.silhouette = pi
          ? {
              src:
                pi._links?.vectorFile?.href ||
                pi._links?.rasterFiles?.at(-1)?.href,
              credit:
                pi.attribution ||
                pi._links?.contributor?.title ||
                'PhyloPic contributor',
              license: shortLicense(pi._links?.license?.href || ''),
              link: `https://www.phylopic.org/images/${pi.uuid}`,
            }
          : null;
        info.images =
          gbif.status === 'fulfilled' ? gbifImages(gbif.value.results) : [];
        return info;
      })().catch((e) => {
        cache.delete(id);
        throw e;
      }),
    );
  return cache.get(id);
}

/** iDigBio media items -> pictures (https only, one per specimen record). */
export function idigbioImages(items, n = 4) {
  const out = [];
  const seen = new Set();
  for (const it of items ?? []) {
    const t = it.indexTerms ?? {};
    const d = it.data ?? {};
    const src = t.accessuri ?? d['ac:accessURI'];
    const rec = t.records?.[0];
    if (!src?.startsWith('https://') || seen.has(rec)) continue;
    seen.add(rec);
    out.push({
      src,
      credit:
        d['xmpRights:Owner'] ||
        d['dc:creator'] ||
        d['dcterms:title'] ||
        'iDigBio publisher',
      license: shortLicense(
        t.rights || d['dcterms:rights'] || d['xmpRights:UsageTerms'] || '',
      ),
      where: '',
      link: rec
        ? `https://portal.idigbio.org/portal/records/${rec}`
        : 'https://portal.idigbio.org',
    });
    if (out.length >= n) break;
  }
  return out;
}

/** Specimen photos from iDigBio (no key): California specimens first, then any. */
export async function loadIdigbio(taxon) {
  const q = (rq) =>
    `https://search.idigbio.org/v2/search/media/?rq=${encodeURIComponent(JSON.stringify(rq))}&limit=12`;
  const name = taxon.toLowerCase();
  const ca = await json(
    q({ scientificname: name, stateprovince: 'california' }),
  ).catch(() => ({ items: [] }));
  let imgs = idigbioImages(ca.items).map((i) => ({
    ...i,
    where: 'California',
  }));
  if (imgs.length < 2) {
    const any = await json(q({ scientificname: name })).catch(() => ({
      items: [],
    }));
    imgs = [...imgs, ...idigbioImages(any.items)]
      .filter((v, i, a) => a.findIndex((x) => x.src === v.src) === i)
      .slice(0, 4);
  }
  return imgs;
}

/** Smithsonian Open Access rows -> pictures. Only used when an api.data.gov key is set. */
export function smithsonianImages(rows, n = 4) {
  const out = [];
  for (const r of rows ?? []) {
    const media = r.content?.descriptiveNonRepeating?.online_media?.media ?? [];
    const m = media.find(
      (x) =>
        x.type === 'Images' &&
        (x.content || x.thumbnail)?.startsWith('https://'),
    );
    if (!m) continue;
    out.push({
      src: m.thumbnail || m.content,
      credit: r.content?.descriptiveNonRepeating?.data_source || 'Smithsonian',
      license:
        m.usage?.access === 'CC0' ? 'CC0' : m.usage?.access || 'see record',
      where: r.title || '',
      link:
        r.content?.descriptiveNonRepeating?.record_link ||
        'https://www.si.edu/openaccess',
    });
    if (out.length >= n) break;
  }
  return out;
}

export async function loadSmithsonian(taxon, key) {
  if (!key) return [];
  const url = `https://api.si.edu/openaccess/api/v1.0/search?q=${encodeURIComponent(`${taxon} AND online_media_type:Images`)}&rows=10&api_key=${encodeURIComponent(key)}`;
  const d = await json(url).catch(() => null);
  return smithsonianImages(d?.response?.rows);
}
