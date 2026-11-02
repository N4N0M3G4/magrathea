// Data Bundles runtime. Reads /bundles/registry.json (written by
// `npm run bundle`) and adds only the enabled bundles' layers to the viewer.
// A missing registry means no bundles: the core app runs unchanged.
import * as Cesium from 'cesium';
import { leftDock } from '../georecon/leftDock.js';
import { el, fields, link, openModal } from '../georecon/modal.js';
import {
  loadFossilDetails,
  loadIdigbio,
  loadSmithsonian,
} from '../georecon/fossilInfo.js';
import { mountFossil3d } from '../georecon/fossilSlots.js';
import {
  loadLexicon,
  loadUnitAt,
  loadWikiSummary,
} from '../georecon/geoUnit.js';
import {
  basemapOptions,
  getBasemap,
  getOpacity,
  setBasemap,
  setOpacity,
} from '../georecon/layerPrefs.js';

const prefs = () => {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
};

const BASE = import.meta.env?.BASE_URL || '/';
let basemapActive = false;
/** PBDB snapshot records grouped by collection id, for the modal's list. */
const byCollection = new Map();
// Stack order we keep: GEV's own imagery, then our basemap, then our overlays.
const ours = { basemap: null, overlays: [] };
function restack(viewer) {
  const layers = viewer.imageryLayers;
  if (ours.basemap && layers.contains(ours.basemap))
    layers.raiseToTop(ours.basemap);
  for (const o of ours.overlays) if (layers.contains(o)) layers.raiseToTop(o);
  viewer.scene.requestRender();
}

/** Show/hide plus opacity for a point data source (points and cone polygons). */
function pointLayerHandle(viewer, ds, color, initial) {
  let alpha = initial;
  const apply = () => {
    for (const e of ds.entities.values) {
      if (e.point) {
        e.point.outlineColor = color.withAlpha(alpha);
        if (e.point.color?.getValue?.()?.alpha > 0)
          e.point.color = color.withAlpha(alpha);
      }
      if (e.polygon) e.polygon.material = color.withAlpha(0.35 * alpha);
    }
    viewer.scene.requestRender();
  };
  ds.entities.collectionChanged.addEventListener(apply);
  apply();
  return {
    set(on) {
      ds.show = on;
      viewer.scene.requestRender();
    },
    setOpacity(a) {
      alpha = a;
      apply();
    },
  };
}

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
  ours.overlays.push(imagery);
  imagery.alpha = layer.opacity;
  // GEV hides the ellipsoid globe under photorealistic tiles; imagery drapes
  // on the globe, so showing the layer shows the globe too.
  const wasGlobe = viewer.scene.globe.show;
  return {
    set(on) {
      imagery.show = on;
      viewer.scene.globe.show = on || wasGlobe || basemapActive;
      viewer.scene.requestRender();
    },
    setOpacity(a) {
      imagery.alpha = a;
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
    if (rec.cid)
      (
        byCollection.get(rec.cid) ?? byCollection.set(rec.cid, []).get(rec.cid)
      ).push(rec);
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
      properties: {
        grKind: 'fossil',
        oid: rec.oid,
        cid: rec.cid,
        tna: rec.tna ?? '',
      },
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
          pixelSize: 14,
          color,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        name: `Capture ${c.id.slice(0, 8)}`,
        properties: {
          grKind: 'capture',
          capture: c,
          photoUrl: `${BASE}${root}${c.photo}`,
        },
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
    'background:rgba(4,7,9,.88);border:1px solid #1a6f80;' +
    'color:#3fe0ff;font:12px ui-monospace,Menlo,monospace;padding:8px 10px;max-width:280px';
  const title = document.createElement('div');
  title.textContent = 'DATA BUNDLES'; // i18n-ignore: GEO-RECON fork panel, English only
  title.style.cssText = 'color:#ffb238;margin-bottom:4px;letter-spacing:.08em';
  panel.append(title, basemapPicker(viewer));
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
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.value = String(Math.round(e.layer.opacity * 100));
    slider.id = `gr-opacity-${e.layer.id}`;
    slider.setAttribute('aria-label', `${e.layer.name ?? e.layer.id} opacity`);
    slider.style.cssText = 'width:100%;accent-color:#3fe0ff;margin:0 0 4px';
    slider.addEventListener('input', () => {
      const a = setOpacity(prefs(), e.layer.id, Number(slider.value) / 100);
      e.handle.setOpacity?.(a);
    });
    panel.append(label, slider);
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
  leftDock().append(panel);
}

/** Basemap select: an imagery layer at the bottom of the stack, under every overlay. */
function basemapPicker(viewer) {
  const options = basemapOptions({
    arcgisKey: import.meta.env?.VITE_ARCGIS_API_KEY,
  });
  const select = document.createElement('select');
  select.id = 'gr-basemap';
  select.setAttribute('aria-label', 'Basemap'); // i18n-ignore: GEO-RECON fork panel, English only
  select.style.cssText =
    'width:100%;margin:2px 0 6px;background:#040709;color:#3fe0ff;border:1px solid #1a6f80;font:inherit';
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o.id;
    opt.disabled = !o.available;
    opt.textContent = o.note ? `${o.name} (${o.note})` : o.name;
    select.append(opt);
  }
  let layer = null;
  let credit = null;
  const wasGlobe = viewer.scene.globe.show;
  const apply = (id) => {
    if (layer) viewer.imageryLayers.remove(layer, true);
    ours.basemap = null;
    if (credit) viewer.creditDisplay?.removeStaticCredit?.(credit);
    layer = null;
    credit = null;
    const o = options.find((x) => x.id === id);
    basemapActive = Boolean(o?.url);
    if (o?.url) {
      layer = viewer.imageryLayers.addImageryProvider(
        new Cesium.UrlTemplateImageryProvider({
          url: o.url,
          maximumLevel: o.maximumLevel,
        }),
      );
      ours.basemap = layer;
      credit = new Cesium.Credit(o.credit);
      viewer.creditDisplay?.addStaticCredit?.(credit);
    }
    // Draped basemaps need the ellipsoid globe; GEV's 3D tiles hide it.
    viewer.scene.globe.show =
      basemapActive || wasGlobe || viewer.imageryLayers.length > 1;
    viewer.scene.requestRender();
  };
  // GEV may add or swap its own imagery later; keep ours above it.
  viewer.imageryLayers.layerAdded.addEventListener((added) => {
    if (added !== ours.basemap && !ours.overlays.includes(added))
      restack(viewer);
  });
  select.value = getBasemap(prefs(), options);
  apply(select.value);
  select.addEventListener('change', () => {
    setBasemap(prefs(), select.value);
    apply(select.value);
  });
  return select;
}

function showCapture(props) {
  const c = props.capture;
  const body = openModal(`FIELD PHOTO ${c.id.slice(0, 8)}`);
  body.append(
    el('img', {
      src: props.photoUrl,
      alt: `Field photo ${c.id.slice(0, 8)}`,
      style: 'max-width:100%;display:block;margin-bottom:8px',
    }),
    fields([
      [
        'Taken',
        c.timestampMs ? new Date(c.timestampMs).toLocaleString() : 'unknown',
      ],
      ['Position', `${c.lat.toFixed(6)}, ${c.lon.toFixed(6)}`],
      ['Accuracy', c.hAccM != null ? `±${Math.round(c.hAccM)} m` : 'unknown'],
      ['Altitude', c.altM != null ? `${Math.round(c.altM)} m` : 'unknown'],
      [
        'Heading',
        c.headingDeg != null ? `${Math.round(c.headingDeg)}°` : 'unknown',
      ],
      [
        'Pitch / roll',
        c.pitchDeg != null
          ? `${Math.round(c.pitchDeg)}° / ${Math.round(c.rollDeg ?? 0)}°`
          : '',
      ],
    ]),
  );
}

/** Captioned image grid; images that fail to load (hotlink refused) are dropped. */
function pictureSection(title, pictures, alt) {
  const grid = el('div', {
    style:
      'display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:6px;margin:4px 0 8px',
  });
  for (const img of pictures) {
    const fig = el(
      'figure',
      { style: 'margin:0' },
      el('img', {
        src: img.src,
        alt,
        loading: 'lazy',
        style:
          'width:100%;height:90px;object-fit:cover;border:1px solid #1a6f80',
      }),
      el(
        'figcaption',
        { style: 'font-size:10px;color:#1a9fb8;overflow-wrap:anywhere' },
        link(img.link, img.credit),
        ` · ${img.license}`,
        img.where ? ` · ${img.where}` : '',
      ),
    );
    fig.querySelector('img').addEventListener('error', () => fig.remove());
    grid.append(fig);
  }
  return el(
    'div',
    {},
    el('div', { style: 'color:#ffb238;margin-top:8px' }, title),
    grid,
  );
}

async function showFossil(props) {
  const body = openModal(`FOSSIL · ${props.tna || 'occurrence'}`);
  const status = el(
    'div',
    { role: 'status', style: 'color:#1a9fb8' },
    'Loading PBDB record…',
  ); // i18n-ignore: GEO-RECON fork panel, English only
  body.append(status);
  const siblings = byCollection.get(props.cid) ?? [];
  try {
    const d = await loadFossilDetails(props.oid, BASE);
    status.remove();
    const head = el('div', {
      style: 'display:flex;gap:10px;align-items:flex-start;margin-bottom:8px',
    });
    if (d.silhouette?.src)
      head.append(
        el('img', {
          src: d.silhouette.src,
          alt: `${d.taxon} silhouette`,
          style:
            'width:96px;height:72px;object-fit:contain;filter:invert(1) sepia(1) hue-rotate(150deg) saturate(4)',
        }),
      );
    head.append(
      el(
        'div',
        {},
        el('div', { style: 'color:#ffb238;font-size:14px' }, d.taxon),
        el('div', {}, [d.rank, d.group].filter(Boolean).join(' · ')),
        el('div', { style: 'color:#1a9fb8;overflow-wrap:anywhere' }, d.lineage),
      ),
    );
    body.append(
      head,
      fields([
        ['Identified as', d.identifiedAs],
        ['Age', d.age],
        ['Formation', d.formation],
        ['Lithology', d.lithology],
        ['Environment', d.environment],
        ['Collection', d.collection],
        ['Place', d.place],
        ['Location precision', d.precision],
        ['Reference', d.reference],
      ]),
      el(
        'div',
        { style: 'display:flex;gap:12px;flex-wrap:wrap;margin-bottom:8px' },
        link(d.occUrl, 'PBDB occurrence ↗'),
        link(d.pbdbUrl, 'PBDB collection ↗'),
      ),
    );
    // Hook for the fossil3d module: hidden until a renderer registers.
    const slot3d = el('div', {
      'data-gr-slot': 'fossil-3d',
      'data-oid': d.oid,
      'data-taxon': d.taxon,
      hidden: '',
      style: 'margin:4px 0 8px;min-height:200px;border:1px solid #1a6f80',
    });
    body.append(slot3d);
    mountFossil3d(slot3d, d);
    const wikiBox = el('div', { style: 'margin:4px 0 8px' });
    body.append(wikiBox);
    const museumBox = el('div');
    body.append(museumBox);
    Promise.all([
      loadIdigbio(d.taxon),
      loadSmithsonian(d.taxon, import.meta.env?.VITE_SI_API_KEY),
    ]).then(([idb, si]) => {
      if (idb.length)
        museumBox.append(
          pictureSection(
            'MUSEUM SPECIMENS (iDigBio)',
            idb,
            `${d.taxon} specimen`,
          ),
        ); // i18n-ignore: GEO-RECON fork panel, English only
      if (si.length)
        museumBox.append(
          pictureSection('SMITHSONIAN OPEN ACCESS', si, `${d.taxon} specimen`),
        ); // i18n-ignore: GEO-RECON fork panel, English only
    });
    loadWikiSummary(d.taxon).then((w) => {
      if (!w) return;
      wikiBox.append(
        el('div', { style: 'overflow-wrap:anywhere' }, w.extract),
        el(
          'div',
          { style: 'color:#1a9fb8;font-size:11px' },
          link(w.url, `Wikipedia: ${w.title}`),
          ' · CC BY-SA 4.0',
        ),
      );
    });
    if (d.silhouette)
      body.append(
        el(
          'div',
          { style: 'color:#1a9fb8;font-size:11px' },
          'Silhouette: ',
          link(d.silhouette.link, `PhyloPic · ${d.silhouette.credit}`),
          ` · ${d.silhouette.license.replace('https://creativecommons.org/', 'CC ')}`,
        ),
      );
    if (d.images.length) {
      const grid = el('div', {
        style:
          'display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:6px;margin:8px 0',
      });
      for (const img of d.images) {
        const fig = el(
          'figure',
          { style: 'margin:0' },
          el('img', {
            src: img.src,
            alt: `${d.taxon} specimen`,
            loading: 'lazy',
            style:
              'width:100%;height:90px;object-fit:cover;border:1px solid #1a6f80',
          }),
          el(
            'figcaption',
            { style: 'font-size:10px;color:#1a9fb8;overflow-wrap:anywhere' },
            link(img.link, img.credit),
            ` · ${img.license}`,
            img.where ? ` · ${img.where}` : '',
          ),
        );
        // Some hosts refuse hotlinking: drop the tile instead of a broken image.
        fig.querySelector('img').addEventListener('error', () => fig.remove());
        grid.append(fig);
      }
      body.append(
        el(
          'div',
          { style: 'color:#ffb238;margin-top:8px' },
          'SPECIMEN PHOTOS (GBIF)',
        ),
        grid,
      ); // i18n-ignore: GEO-RECON fork panel, English only
    }
  } catch (e) {
    status.textContent = `Could not load details: ${e.message}`; // i18n-ignore: GEO-RECON fork panel, English only
  }
  if (siblings.length > 1) {
    const list = el('ul', { style: 'margin:4px 0 0;padding-left:18px' });
    for (const r of siblings) {
      const b = el(
        'button',
        {
          type: 'button',
          style:
            'background:none;border:none;color:#3fe0ff;font:inherit;cursor:pointer;padding:0;text-align:left',
        },
        r.tna || r.oid,
      );
      b.addEventListener('click', () =>
        showFossil({ grKind: 'fossil', oid: r.oid, cid: r.cid, tna: r.tna }),
      );
      list.append(el('li', {}, b));
    }
    body.append(
      el(
        'div',
        { style: 'color:#ffb238;margin-top:8px' },
        `${siblings.length} OCCURRENCES IN THIS COLLECTION`,
      ),
      list,
    ); // i18n-ignore: GEO-RECON fork panel, English only
  }
}

/** Click a bundle feature to open its detail modal (GEV turns off Cesium's InfoBox). */
function installPicking(viewer, geologyShown) {
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((click) => {
    for (const picked of viewer.scene.drillPick(click.position, 5)) {
      const props = picked?.id?.properties?.getValue?.(Cesium.JulianDate.now());
      if (props?.grKind === 'fossil') return void showFossil(props);
      if (props?.grKind === 'capture') return void showCapture(props);
    }
    // Nothing picked: with the geology layer on, describe the unit under the click.
    if (!geologyShown()) return;
    const scene = viewer.scene;
    const cart =
      (scene.pickPositionSupported && scene.pickPosition(click.position)) ||
      viewer.camera.pickEllipsoid(click.position, scene.globe.ellipsoid);
    if (!cart) return;
    const c = Cesium.Cartographic.fromCartesian(cart);
    showUnit(
      Cesium.Math.toDegrees(c.latitude),
      Cesium.Math.toDegrees(c.longitude),
    );
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

async function showUnit(lat, lon) {
  const body = openModal('GEOLOGIC UNIT'); // i18n-ignore: GEO-RECON fork panel, English only
  const status = el(
    'div',
    { role: 'status', style: 'color:#1a9fb8' },
    'Asking Macrostrat…',
  ); // i18n-ignore: GEO-RECON fork panel, English only
  body.append(status);
  try {
    const u = await loadUnitAt(lat, lon);
    status.remove();
    if (!u) return void body.append('No mapped unit here.'); // i18n-ignore: GEO-RECON fork panel, English only
    body.append(
      el(
        'div',
        { style: 'display:flex;gap:8px;align-items:center;margin-bottom:6px' },
        el('span', {
          style: `display:inline-block;width:18px;height:18px;border:1px solid #bfefff;background:${u.color}`,
        }),
        el('span', { style: 'color:#ffb238;font-size:14px' }, u.name),
      ),
      fields([
        ['Stratigraphic name', u.strat],
        ['Age', u.age],
        ['Lithology', u.lith],
        ['Description', u.description],
        ['Point', `${lat.toFixed(5)}, ${lon.toFixed(5)}`],
        ['Map scale', u.scale],
      ]),
      el(
        'div',
        { style: 'color:#1a9fb8;font-size:11px' },
        link(
          `https://macrostrat.org/map/loc/${lon.toFixed(4)}/${lat.toFixed(4)}`,
          'Macrostrat ↗',
        ),
        ` · source ${u.sourceId} · CC BY 4.0`,
      ),
    );
  } catch (e) {
    status.textContent = `Could not reach Macrostrat: ${e.message}`; // i18n-ignore: GEO-RECON fork panel, English only
  }
}

/** Collapsible legend for every GEO-RECON symbol. */
function renderLegend() {
  const swatch = (css) =>
    el('span', {
      style: `display:inline-block;width:14px;height:14px;flex:none;${css}`,
    });
  const row = (sw, text) =>
    el(
      'div',
      { style: 'display:flex;gap:8px;align-items:center;margin:3px 0' },
      sw,
      el('span', {}, text),
    );
  const details = el(
    'details',
    {
      style:
        'background:rgba(4,7,9,.88);border:1px solid #1a6f80;color:#3fe0ff;font:12px ui-monospace,Menlo,monospace;padding:6px 10px',
    },
    el(
      'summary',
      { style: 'color:#ffb238;cursor:pointer;letter-spacing:.08em' },
      'LEGEND',
    ), // i18n-ignore: GEO-RECON fork panel, English only
    row(
      swatch(
        'background:linear-gradient(90deg,#ffff00,#f4a460,#9acd32,#87ceeb)',
      ),
      'Geology: each color is one map unit (rock formation). Click a unit for its name, age and rock type.',
    ), // i18n-ignore: GEO-RECON fork panel, English only
    row(
      swatch('border:2px solid #3fe0ff;border-radius:50%'),
      'Fossil occurrence (PBDB). Click for details and pictures.',
    ), // i18n-ignore: GEO-RECON fork panel, English only
    row(
      swatch('background:#ffb238;border:2px solid #000;border-radius:50%'),
      'Your field photo. Click to view.',
    ), // i18n-ignore: GEO-RECON fork panel, English only
    row(
      swatch(
        'background:rgba(255,178,56,.35);clip-path:polygon(50% 100%,0 0,100% 0)',
      ),
      'Heading cone: which way the camera faced.',
    ), // i18n-ignore: GEO-RECON fork panel, English only
    row(
      swatch('background:#ffb238;border:3px solid #000;border-radius:50%'),
      'Current pin (search or MY GPS).',
    ), // i18n-ignore: GEO-RECON fork panel, English only
  );
  leftDock().append(details);
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
        const opacity = getOpacity(
          prefs(),
          layer.id,
          layer.defaultOpacity ?? 1,
        );
        const resolved = { ...layer, opacity };
        entries.push({
          bundle,
          layer: resolved,
          handle: await build(viewer, resolved),
        });
        viewer.creditDisplay?.addStaticCredit?.(
          new Cesium.Credit(bundle.attribution ?? bundle.name),
        );
      } catch (error) {
        console.warn(`[bundles] ${bundle.id}/${layer.id} failed:`, error);
      }
    }
  }
  if (entries.length) {
    renderPanel(entries, home, viewer);
    renderLegend();
    const geo = entries.find((e) => e.layer.type === 'imagery-xyz');
    installPicking(viewer, () =>
      Boolean(
        geo && document.getElementById(`gr-bundle-${geo.layer.id}`)?.checked,
      ),
    );
    globalThis.__georecon = { viewer, Cesium }; // debugging and headless checks
  }
}
