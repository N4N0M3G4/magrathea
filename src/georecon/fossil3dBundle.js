// Connects the `fossil3d` Data Bundle to the fossil pop-up's 3D slot.
// A bundle layer lists models; each has a `match` regex tested against the
// occurrence's taxon and lineage (family etc.). The first match wins.
import { registerFossil3d } from './fossilSlots.js';

/** Pick the model for a summarized occurrence, or null. Pure; tested. */
export function matchModel(models, info) {
  const text = [info?.taxon, info?.identifiedAs, info?.lineage]
    .filter(Boolean)
    .join(' ');
  for (const m of models ?? []) {
    try {
      if (m.match && new RegExp(m.match, 'i').test(text)) return m;
    } catch {
      // A bad regex in a manifest skips that model.
    }
  }
  return null;
}

/** Register a renderer for a `fossil3d` bundle layer. `base` prefixes URLs. */
export function registerFossil3dLayer(layer, base = '/') {
  const url = (p) => (p ? base + p.replace(/^\//, '') : undefined);
  registerFossil3d(async (container, info) => {
    const model = matchModel(layer.models, info);
    if (!model) {
      container.hidden = true;
      return () => {};
    }
    container.style.height = '300px';
    container.style.position = 'relative';
    container.style.background = '#000';
    const { mountFossil3D } = await import('./fossil3dViewer.js');
    const demo = model.demo ?? {};
    const view = await mountFossil3D(container, {
      referenceUrl: url(model.referenceUrl),
      referenceMeta: url(model.referenceMeta),
      fragmentUrl: url(demo.fragmentUrl),
      result: url(demo.result),
      note: demo.label,
    });
    return () => view.dispose();
  });
}
