// GEO-RECON current pin on the hub globe: set by address search or browser
// GPS, persisted, drawn as a temp pin, with zoom-lock and recenter controls.
import * as Cesium from 'cesium';
import { createPinStore, lockedZoomRange } from './pinState.js';

const UI = {
  cyan: '#3fe0ff',
  dim: '#1a6f80',
  amber: '#ffb238',
  bg: 'rgba(4,7,9,.9)',
  font: '12px ui-monospace,Menlo,monospace',
};

let store = null;
const myLocationLabel = (acc) => `MY LOCATION ±${Math.round(acc)} m`; // i18n-ignore: GEO-RECON fork panel, English only
const storage = () => {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
};

/** Called by the place search when it resolves a place. */
export function announcePlace(lat, lon, label) {
  (store ??= createPinStore(storage())).set({
    lat,
    lon,
    label,
    source: 'search',
  });
}

function button(text, title) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.style.cssText = `background:none;border:1px solid ${UI.cyan};color:${UI.cyan};font:${UI.font};cursor:pointer;padding:2px 6px;white-space:nowrap`;
  return b;
}

function locateOnce() {
  return new Promise((ok, fail) => {
    if (!navigator.geolocation)
      return fail(new Error('This browser has no location access'));
    navigator.geolocation.getCurrentPosition(
      (p) => ok(p.coords),
      (e) =>
        fail(
          new Error(
            e.code === 1
              ? 'Location permission denied. Allow it in the browser address bar.'
              : 'Could not get a location fix',
          ),
        ),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  });
}

export function startCurrentPin(viewer) {
  store ??= createPinStore(storage());
  const scene = viewer.scene;
  const camera = viewer.camera;
  const controller = scene.screenSpaceCameraController;

  // Pin entity
  const pinEntity = viewer.entities.add({
    id: 'georecon-current-pin',
    show: false,
    position: Cesium.Cartesian3.fromDegrees(0, 0),
    point: {
      pixelSize: 14,
      color: Cesium.Color.fromCssColorString(UI.amber),
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 3,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });
  const pinPosition = (pin) => {
    const c = Cesium.Cartographic.fromDegrees(pin.lon, pin.lat);
    const h = scene.globe.show
      ? scene.globe.getHeight(c)
      : scene.sampleHeightSupported
        ? scene.sampleHeight(c)
        : undefined;
    return Cesium.Cartesian3.fromDegrees(
      pin.lon,
      pin.lat,
      Number.isFinite(h) ? h : 0,
    );
  };

  // Panel
  const panel = document.createElement('div');
  panel.id = 'gr-pin';
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'Current pin'); // i18n-ignore: GEO-RECON fork panel, English only
  panel.style.cssText = `position:fixed;left:12px;bottom:245px;z-index:51;background:${UI.bg};border:1px solid ${UI.dim};color:${UI.cyan};font:${UI.font};padding:8px 10px;max-width:300px;display:flex;flex-direction:column;gap:6px`;
  const label = document.createElement('div');
  label.style.cssText = `color:${UI.amber};overflow:hidden;text-overflow:ellipsis;white-space:nowrap`;
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
  const lockBtn = button('LOCK', 'Keep zoom centered on the pin'); // i18n-ignore: GEO-RECON fork panel, English only
  const recenterBtn = button('RECENTER', 'Fly back to the pin'); // i18n-ignore: GEO-RECON fork panel, English only
  const gpsBtn = button('MY GPS', 'Set the pin to my current location'); // i18n-ignore: GEO-RECON fork panel, English only
  const clearBtn = button('CLEAR', 'Remove the pin'); // i18n-ignore: GEO-RECON fork panel, English only
  const status = document.createElement('div');
  status.setAttribute('role', 'status');
  status.style.cssText = `color:${UI.dim};min-height:1em`;
  row.append(lockBtn, recenterBtn, gpsBtn, clearBtn);
  panel.append(label, row, status);
  document.body.append(panel);

  const flyToPin = (pin, range = 1500) =>
    camera.flyToBoundingSphere(new Cesium.BoundingSphere(pinPosition(pin), 1), {
      offset: new Cesium.HeadingPitchRange(
        camera.heading,
        Cesium.Math.toRadians(-45),
        range,
      ),
      duration: 1.5,
    });

  function render(pin) {
    pinEntity.show = Boolean(pin);
    if (pin) {
      pinEntity.position = pinPosition(pin);
      pinEntity.name = pin.label;
    }
    const pinPrefix = 'PIN · '; // i18n-ignore: GEO-RECON fork panel, English only
    const noPin = 'PIN · none (search or MY GPS)'; // i18n-ignore: GEO-RECON fork panel, English only
    label.textContent = pin ? pinPrefix + pin.label : noPin;
    label.title = pin
      ? `${pin.label} (${pin.lat.toFixed(5)}, ${pin.lon.toFixed(5)})`
      : '';
    for (const b of [lockBtn, recenterBtn, clearBtn]) b.disabled = !pin;
    const locked = Boolean(pin?.locked);
    lockBtn.textContent = locked ? 'LOCKED' : 'LOCK'; // i18n-ignore: GEO-RECON fork panel, English only
    lockBtn.setAttribute('aria-pressed', String(locked));
    lockBtn.style.background = locked ? UI.cyan : 'none';
    lockBtn.style.color = locked ? '#040709' : UI.cyan;
    // Cesium's own wheel zoom goes toward the cursor; while locked we take over.
    controller.enableZoom = !locked;
    scene.requestRender();
  }

  // Locked zoom: wheel scales the camera-to-pin distance, keeping the pin centered.
  const canvas = scene.canvas;
  canvas.addEventListener(
    'wheel',
    (e) => {
      const pin = store.get();
      if (!pin?.locked) return;
      e.preventDefault();
      const target = pinPosition(pin);
      const range = Cesium.Cartesian3.distance(camera.positionWC, target);
      const next = lockedZoomRange(range, e.deltaY);
      camera.lookAt(
        target,
        new Cesium.HeadingPitchRange(camera.heading, camera.pitch, next),
      );
      camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      scene.requestRender();
    },
    { passive: false },
  );

  lockBtn.addEventListener('click', () => {
    const pin = store.setLocked(!store.get()?.locked);
    if (pin?.locked)
      flyToPin(
        pin,
        Math.min(
          Cesium.Cartesian3.distance(camera.positionWC, pinPosition(pin)),
          20000,
        ),
      );
  });
  recenterBtn.addEventListener(
    'click',
    () => store.get() && flyToPin(store.get()),
  );
  clearBtn.addEventListener('click', () => store.clear());
  async function useGps() {
    status.textContent = 'Getting location…'; // i18n-ignore: GEO-RECON fork panel, English only
    try {
      const c = await locateOnce();
      const pin = store.set({
        lat: c.latitude,
        lon: c.longitude,
        label: myLocationLabel(c.accuracy),
        source: 'gps',
      });
      status.textContent = '';
      flyToPin(pin);
    } catch (err) {
      status.textContent = err.message;
    }
  }
  gpsBtn.addEventListener('click', useGps);

  // Locate icon next to GEV's address search box (it may mount after us).
  const addLocateIcon = () => {
    const input = document.getElementById('location-search');
    if (!input || document.getElementById('gr-locate')) return Boolean(input);
    const b = button('◎', 'Use my current location as the pin'); // i18n-ignore: GEO-RECON fork panel, English only
    b.id = 'gr-locate';
    b.style.marginLeft = '4px';
    b.addEventListener('click', useGps);
    input.insertAdjacentElement('afterend', b);
    return true;
  };
  if (!addLocateIcon()) {
    const obs = new MutationObserver(() => addLocateIcon() && obs.disconnect());
    obs.observe(document.body, { childList: true, subtree: true });
  }

  store.subscribe(render);
  render(store.get());
}
