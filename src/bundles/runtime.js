// Data Bundles runtime. Reads /bundles/registry.json (written by
// `npm run bundle`) and adds only the enabled bundles' layers to the viewer.
// A missing registry means no bundles: the core app runs unchanged.
import * as Cesium from 'cesium';

const BASE = import.meta.env?.BASE_URL || '/';

async function loadRegistry() {
  try {
    const r = await fetch(`${BASE}bundles/registry.json`, {
      cache: 'no-cache',
    });
    return r.ok ? await r.json() : { bundles: [] };
  } catch {
    return { bundles: [] };
  }
}

function addImageryXyz(viewer, layer) {
  const provider = new Cesium.UrlTemplateImageryProvider({
    url: layer.url,
    maximumLevel: layer.maximumLevel ?? 18,
    // Macrostrat serves 512 px tiles; Cesium assumes 256 unless told.
    tileWidth: layer.tileSize ?? 256,
    tileHeight: layer.tileSize ?? 256,
    rectangle: layer.rectangle
      ? Cesium.Rectangle.fromDegrees(...layer.rectangle)
      : undefined,
  });
  const imagery = viewer.imageryLayers.addImageryProvider(provider);
  imagery.alpha = layer.alpha ?? 0.7;
  // GEV hides the ellipsoid globe under photorealistic tiles; imagery drapes
  // on the globe, so showing the layer shows the globe too.
  const wasGlobe = viewer.scene.globe.show;
  return {
    set(on) {
      imagery.show = on;
      viewer.scene.globe.show = on || wasGlobe;
      viewer.scene.requestRender();
    },
  };
}

async function addPbdbPoints(viewer, layer) {
  const r = await fetch(`${BASE}${layer.data}`);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${layer.data}`);
  const json = await r.json();
  const ds = new Cesium.CustomDataSource(layer.id);
  const color = Cesium.Color.fromCssColorString(layer.color ?? '#3FE0FF');
  for (const rec of json.records ?? []) {
    const lat = Number(rec.lat),
      lon = Number(rec.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    ds.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat),
      point: {
        pixelSize: 9,
        color: Cesium.Color.TRANSPARENT,
        outlineColor: color,
        outlineWidth: 2,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      name: rec.tna || 'Fossil occurrence',
      description: `<p><b>${rec.tna ?? ''}</b></p><p>Formation: ${rec.sfm ?? 'unknown'}</p><p>PBDB ${rec.oid ?? ''}</p>`,
    });
  }
  await viewer.dataSources.add(ds);
  return {
    set(on) {
      ds.show = on;
      viewer.scene.requestRender();
    },
  };
}

/** Destination point `m` metres from lon/lat along bearing `deg` (flat-earth, fine for <1 km). */
function offset(lon, lat, deg, m) {
  const r = Cesium.Math.toRadians(deg);
  const dLat = (m * Math.cos(r)) / 111320;
  const dLon =
    (m * Math.sin(r)) / (111320 * Math.cos(Cesium.Math.toRadians(lat)));
  return [lon + dLon, lat + dLat];
}

function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

async function addCaptures(viewer, layer) {
  const ds = new Cesium.CustomDataSource(layer.id);
  const color = Cesium.Color.fromCssColorString(layer.color ?? '#FFB238');
  const root = layer.index.replace(/[^/]*$/, '');
  let seen = '';
  async function refresh() {
    let json;
    try {
      const r = await fetch(`${BASE}${layer.index}`, { cache: 'no-cache' });
      if (!r.ok) return;
      json = await r.json();
    } catch {
      return; // no captures yet, or not valid JSON (SPA fallback)
    }
    const caps = (json.captures ?? []).filter(
      (c) => Number.isFinite(c.lat) && Number.isFinite(c.lon),
    );
    const key = caps.map((c) => `${c.id}:${c.headingDeg}`).join(',');
    if (key === seen) return;
    seen = key;
    ds.entities.removeAll();
    for (const c of caps) {
      const when = c.timestampMs
        ? new Date(c.timestampMs).toISOString()
        : 'unknown time';
      ds.entities.add({
        id: `capture-${c.id}`,
        position: Cesium.Cartesian3.fromDegrees(c.lon, c.lat),
        point: {
          pixelSize: 11,
          color,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        name: `Capture ${c.id.slice(0, 8)}`,
        description:
          `<p><img src="${BASE}${root}${escapeHtml(c.photo)}" style="max-width:100%"></p>` +
          `<p>${escapeHtml(when)}<br>${c.lat.toFixed(5)}, ${c.lon.toFixed(5)} ±${escapeHtml(c.hAccM ?? '?')} m` +
          `<br>Heading ${escapeHtml(c.headingDeg ?? '?')}°</p>`,
      });
      if (Number.isFinite(c.headingDeg)) {
        // Heading cone: two 25 m rays at ±20° around the camera heading.
        const left = offset(c.lon, c.lat, c.headingDeg - 20, 25);
        const right = offset(c.lon, c.lat, c.headingDeg + 20, 25);
        ds.entities.add({
          polygon: {
            hierarchy: Cesium.Cartesian3.fromDegreesArray([
              c.lon,
              c.lat,
              ...left,
              ...right,
            ]),
            material: color.withAlpha(0.35),
            outline: false,
            classificationType: Cesium.ClassificationType.BOTH,
          },
        });
      }
    }
    viewer.scene.requestRender();
  }
  await refresh();
  const timer = setInterval(refresh, 10_000);
  viewer.scene.preRender.addEventListener(function stop() {
    if (viewer.isDestroyed?.()) clearInterval(timer);
  });
  await viewer.dataSources.add(ds);
  return {
    set(on) {
      ds.show = on;
      viewer.scene.requestRender();
    },
  };
}

const BUILDERS = {
  'imagery-xyz': addImageryXyz,
  'points-pbdb': addPbdbPoints,
  captures: addCaptures,
};

function renderPanel(entries, home, viewer) {
  const panel = document.createElement('div');
  panel.id = 'gr-bundles';
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'Data bundles'); // i18n-ignore: GEO-RECON fork panel, English only
  panel.style.cssText =
    'position:fixed;left:12px;bottom:120px;z-index:50;background:rgba(4,7,9,.88);border:1px solid #1a6f80;' +
    'color:#3fe0ff;font:12px ui-monospace,Menlo,monospace;padding:8px 10px;max-width:280px';
  const title = document.createElement('div');
  title.textContent = 'DATA BUNDLES'; // i18n-ignore: GEO-RECON fork panel, English only
  title.style.cssText = 'color:#ffb238;margin-bottom:4px;letter-spacing:.08em';
  panel.append(title);
  for (const e of entries) {
    const label = document.createElement('label');
    label.style.cssText =
      'display:flex;gap:6px;align-items:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    label.title = `${e.bundle.name} · ${e.bundle.license}`;
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.id = `gr-bundle-${e.layer.id}`;
    box.checked = true;
    box.addEventListener('change', () => e.handle.set(box.checked));
    const text = document.createElement('span');
    text.textContent = e.layer.name ?? e.layer.id;
    text.style.cssText = 'overflow:hidden;text-overflow:ellipsis';
    label.append(box, text);
    panel.append(label);
  }
  if (home) {
    const go = document.createElement('button');
    go.type = 'button';
    go.textContent = `FLY TO ${home.label.toUpperCase()}`; // i18n-ignore: GEO-RECON fork panel, English only
    go.style.cssText =
      'margin-top:6px;background:none;border:1px solid #3fe0ff;color:#3fe0ff;font:inherit;cursor:pointer;padding:2px 6px';
    go.addEventListener('click', () =>
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          home.lon,
          home.lat - 0.03,
          4500,
        ),
        orientation: { pitch: Cesium.Math.toRadians(-35) },
      }),
    );
    panel.append(go);
  }
  document.body.append(panel);
}

/** Start enabled bundles on a viewer. Never throws: a bad bundle is logged and skipped. */
export async function startBundles(viewer) {
  const { bundles = [] } = await loadRegistry();
  if (!bundles.length || viewer.isDestroyed?.()) return;
  const entries = [];
  let home = null;
  for (const bundle of bundles) {
    home ??= bundle.home ?? null;
    for (const layer of bundle.layers ?? []) {
      const build = BUILDERS[layer.type];
      if (!build) continue; // 'core' layers are fed by files, nothing to add
      try {
        entries.push({ bundle, layer, handle: await build(viewer, layer) });
        viewer.creditDisplay?.addStaticCredit?.(
          new Cesium.Credit(bundle.attribution ?? bundle.name),
        );
      } catch (error) {
        console.warn(`[bundles] ${bundle.id}/${layer.id} failed:`, error);
      }
    }
  }
  if (entries.length) renderPanel(entries, home, viewer);
}
