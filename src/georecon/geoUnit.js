// Geology-unit and taxon-summary lookups for GEO-RECON taps (no keys needed).
// Macrostrat (CC BY 4.0) and Wikipedia REST summaries (CC BY-SA) allow CORS.

const units = new Map();
const wiki = new Map();

/** Flatten a Macrostrat geologic_units/map record for the modal. */
export function summarizeUnit(u) {
  const age = (v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(1) : '?');
  const interval =
    u.b_int_name === u.t_int_name || !u.t_int_name
      ? u.b_int_name
      : `${u.b_int_name} – ${u.t_int_name}`;
  return {
    name: u.name || u.strat_name || 'Unnamed unit',
    strat: u.strat_name && u.strat_name !== u.name ? u.strat_name : '',
    age: `${interval || 'unknown'} (${age(u.b_age)}–${age(u.t_age)} Ma)`,
    lith: u.lith || '',
    description: u.descrip || '',
    color: /^#[0-9a-f]{6}$/i.test(u.color ?? '') ? u.color : '#888888',
    sourceId: u.source_id ?? '',
    mapId: u.map_id ?? '',
    stratNameIds: Array.isArray(u.strat_names)
      ? u.strat_names.filter(Number.isFinite)
      : [],
  };
}

/** The unit at a point (largest-scale map first), or null. Cached by ~10 m cell. */
export function loadUnitAt(lat, lon) {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  if (!units.has(key))
    units.set(
      key,
      (async () => {
        for (const scale of ['large', 'medium', 'small']) {
          const r = await fetch(
            `https://macrostrat.org/api/v2/geologic_units/map?lat=${lat}&lng=${lon}&scale=${scale}`,
          );
          const d = (await r.json())?.success?.data?.[0];
          if (d) return { ...summarizeUnit(d), scale };
        }
        return null;
      })().catch((e) => {
        units.delete(key);
        throw e;
      }),
    );
  return units.get(key);
}

/** Wikipedia title candidates for a taxon: full name, then genus. */
export function wikiTitles(taxon = '') {
  const t = taxon.trim();
  const genus = t.split(/\s+/)[0];
  return [...new Set([t, genus].filter(Boolean))];
}

/** Short Wikipedia summary {title, extract, url, thumb} for a taxon, or null. */
export function loadWikiSummary(taxon) {
  if (!wiki.has(taxon))
    wiki.set(
      taxon,
      (async () => {
        for (const title of wikiTitles(taxon)) {
          const r = await fetch(
            `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`,
          );
          if (!r.ok) continue;
          const d = await r.json();
          if (d.type !== 'standard' || !d.extract) continue;
          return {
            title: d.title,
            extract: d.extract,
            url: d.content_urls?.desktop?.page,
            thumb: d.thumbnail?.source ?? null,
          };
        }
        return null;
      })().catch(() => null),
    );
  return wiki.get(taxon);
}

const lexicon = new Map();

/** Combine Macrostrat strat-name definition + its column units into one summary. */
export function summarizeLexicon(def, units = []) {
  if (!def) return null;
  const lith = new Map();
  const env = new Set();
  let maxThick = 0;
  for (const u of units) {
    maxThick = Math.max(maxThick, Number(u.max_thick) || 0);
    for (const l of u.lith ?? [])
      lith.set(
        l.name,
        (lith.get(l.name) ?? 0) + (Number(l.prop) || 0) / units.length,
      );
    for (const e of u.environ ?? []) if (e.name) env.add(e.name);
  }
  const lithText = [...lith.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([n, p]) => `${n} ${Math.round(p * 100)}%`)
    .join(', ');
  const ma = (v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(1) : '?');
  return {
    longName: def.strat_name_long || def.strat_name,
    rank:
      {
        Fm: 'Formation',
        Mbr: 'Member',
        Gp: 'Group',
        SGp: 'Supergroup',
        Bed: 'Bed',
      }[def.rank] ??
      def.rank ??
      '',
    parent: [
      def.gp && `${def.gp} Group`,
      def.fm && def.rank !== 'Fm' && `${def.fm} Formation`,
    ]
      .filter(Boolean)
      .join(', '),
    range: `${ma(def.b_age)}–${ma(def.t_age)} Ma (${def.b_period || '?'}${def.t_period && def.t_period !== def.b_period ? `–${def.t_period}` : ''})`,
    columns: units.length,
    maxThicknessM: maxThick || null,
    lithology: lithText,
    environments: [...env].join(', '),
    conceptUrl: def.concept_id
      ? `https://macrostrat.org/lex/strat-name-concepts/${def.concept_id}`
      : `https://macrostrat.org/lex/strat-names/${def.strat_name_id}`,
  };
}

/** Lexicon + column summary for a strat_name_id (cached). */
export function loadLexicon(id) {
  if (!lexicon.has(id))
    lexicon.set(
      id,
      (async () => {
        const [d, u] = await Promise.all([
          fetch(
            `https://macrostrat.org/api/v2/defs/strat_names?strat_name_id=${id}`,
          ).then((r) => r.json()),
          fetch(
            `https://macrostrat.org/api/v2/units?strat_name_id=${id}&response=long`,
          ).then((r) => r.json()),
        ]);
        return summarizeLexicon(d?.success?.data?.[0], u?.success?.data ?? []);
      })().catch(() => null),
    );
  return lexicon.get(id);
}
