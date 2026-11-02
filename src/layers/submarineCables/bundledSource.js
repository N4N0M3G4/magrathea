// This dataset is CC BY-NC-SA 3.0, not the project's MIT license.
// Commercial users must remove it or obtain a TeleGeography license.
// See DATA_SOURCES.md and the bundled dataset's source.json.
// Resolved when read, so importing this module never needs a module URL.
// GEO-RECON: the data now ships as the optional Data Bundle
// "telegeography-submarine-cables" (npm run bundle -- add telegeography-submarine-cables).
const BUNDLE_ROOT = `${import.meta.env?.BASE_URL || '/'}bundles/telegeography-submarine-cables/`;
function cableUrl() {
  return `${BUNDLE_ROOT}cable-geo.json`;
}
function landingPointUrl() {
  return `${BUNDLE_ROOT}landing-point-geo.json`;
}

/** Supply GeoJSON collections without coupling the renderer to asset URLs. */
export function createBundledCableSource({
  fetchImpl = (...args) => fetch(...args),
} = {}) {
  async function read(url, signal) {
    signal?.throwIfAborted();
    const response = await fetchImpl(url, { signal, cache: 'force-cache' });
    if (!response.ok) {
      try {
        await response.body?.cancel();
      } catch {
        /* best effort */
      }
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    const json = await response.json();
    signal?.throwIfAborted();
    return json;
  }
  return {
    label: 'TeleGeography', // i18n-ignore: data provider name
    async fetch(signal) {
      const [cables, landingPoints] = await Promise.all([
        read(cableUrl(), signal),
        read(landingPointUrl(), signal),
      ]);
      return { cables, landingPoints };
    },
  };
}
