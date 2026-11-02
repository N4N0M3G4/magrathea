// Per-layer opacity and basemap choice for the GEO-RECON hub, persisted in
// localStorage. Pure logic so it is unit-tested directly.

const OPACITY_KEY = 'georecon.opacity.v1';
const BASEMAP_KEY = 'georecon.basemap.v1';

export const clampOpacity = (v, fallback = 1) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), 1) : fallback;
};

function readJson(storage, key) {
  try {
    return JSON.parse(storage?.getItem(key) ?? 'null') ?? {};
  } catch {
    return {};
  }
}
function writeJson(storage, key, value) {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode: keep defaults */
  }
}

export function getOpacity(storage, layerId, fallback = 1) {
  const all = readJson(storage, OPACITY_KEY);
  return layerId in all
    ? clampOpacity(all[layerId], fallback)
    : clampOpacity(fallback);
}
export function setOpacity(storage, layerId, value) {
  const all = readJson(storage, OPACITY_KEY);
  all[layerId] = clampOpacity(value);
  writeJson(storage, OPACITY_KEY, all);
  return all[layerId];
}

/**
 * Basemaps offered under the overlays. Esri street/topo need an ArcGIS
 * Location Platform API key (VITE_ARCGIS_API_KEY in .env); without one they
 * are listed as unavailable. "gev" keeps God's Eye View's own globe (keyless
 * Esri World Imagery or Google 3D Tiles when configured).
 */
export function basemapOptions({ arcgisKey = '' } = {}) {
  const key = String(arcgisKey || '').trim();
  // ArcGIS static basemap tiles service (Location Platform); style e.g. arcgis/streets.
  const esri = (style, name) => ({
    id: `esri-${style.split('/')[1]}`,
    name,
    available: Boolean(key),
    note: key ? '' : 'Needs VITE_ARCGIS_API_KEY',
    url: `https://static-map-tiles-api.arcgis.com/arcgis/rest/services/static-basemap-tiles-service/v1/${style}/static/tile/{z}/{y}/{x}?token=${encodeURIComponent(key)}`,
    credit: 'Esri, HERE, Garmin, USGS, NGA, EPA, USDA, NPS',
    maximumLevel: 19,
  });
  return [
    {
      id: 'gev',
      name: 'Satellite (GEV default)',
      available: true,
      note: '',
      url: null,
    },
    {
      id: 'osm-streets',
      name: 'Streets (OpenStreetMap)',
      available: true,
      note: '',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      credit: '© OpenStreetMap contributors (ODbL)',
      maximumLevel: 19,
    },
    {
      id: 'carto-dark',
      name: 'Dark spy (CARTO)',
      available: true,
      note: '',
      url: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
      credit: '© OpenStreetMap contributors, © CARTO',
      maximumLevel: 19,
    },
    esri('arcgis/streets', 'Streets (Esri)'),
    esri('arcgis/topographic', 'Topo (Esri)'),
    esri('arcgis/dark-gray', 'Dark gray (Esri)'),
  ];
}

export function getBasemap(storage, options) {
  const want = readJson(storage, BASEMAP_KEY).id;
  const hit = options.find((o) => o.id === want && o.available);
  return hit ? hit.id : 'gev';
}
export function setBasemap(storage, id) {
  writeJson(storage, BASEMAP_KEY, { id });
}
