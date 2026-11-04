// Extension point for the fossil modal. The fossil3d module (built separately
// in ~/personal/geo-recon/fossil3d/) registers a renderer here; until then the
// 3D slot stays empty and hidden.
//
//   import { registerFossil3d } from './fossilSlots.js';
//   registerFossil3d(async (container, info) => { /* mount viewer */ return () => {/* dispose */}; });
//
// `info` is the summarized occurrence (taxon, taxonNo, oid, cid, group, ...).

let renderer = null;

export function registerFossil3d(fn) {
  renderer = typeof fn === 'function' ? fn : null;
}

export const hasFossil3d = () => renderer !== null;

/** Fill `container` with the 3D view if a renderer is registered. Returns a dispose fn. */
export async function mountFossil3d(container, info) {
  if (!renderer) return () => {};
  container.hidden = false;
  try {
    return (await renderer(container, info)) ?? (() => {});
  } catch (e) {
    container.textContent = `The 3D view tripped over something: ${e.message}`; // i18n-ignore: GEO-RECON fork panel, English only
    return () => {};
  }
}
