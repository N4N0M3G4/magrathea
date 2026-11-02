// Current-pin state for the GEO-RECON hub: one pin, persisted in localStorage.
// Pure logic, no Cesium, so it is unit-tested directly.

export const PIN_STORAGE_KEY = 'georecon.currentPin.v1';

/** A valid pin has finite lat/lon in range; anything else is rejected. */
export function normalizePin(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const lat = Number(raw.lat);
  const lon = Number(raw.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const label =
    typeof raw.label === 'string' && raw.label.trim()
      ? raw.label.trim().slice(0, 120)
      : `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  const source = ['search', 'gps', 'manual'].includes(raw.source)
    ? raw.source
    : 'manual';
  return {
    lat,
    lon,
    label,
    source,
    locked: raw.locked !== false,
    setAt: Number(raw.setAt) || Date.now(),
  };
}

/** Pin store over a Storage-like object (getItem/setItem/removeItem). Storage may be missing or throw. */
export function createPinStore(storage, listeners = new Set()) {
  let current = null;
  try {
    current = normalizePin(
      JSON.parse(storage?.getItem(PIN_STORAGE_KEY) ?? 'null'),
    );
  } catch {
    current = null;
  }
  const save = () => {
    try {
      if (current) storage?.setItem(PIN_STORAGE_KEY, JSON.stringify(current));
      else storage?.removeItem(PIN_STORAGE_KEY);
    } catch {
      /* private mode or quota: keep in memory */
    }
    for (const fn of listeners) fn(current);
  };
  return {
    get: () => current,
    set(raw) {
      const pin = normalizePin({
        locked: current?.locked ?? true,
        ...raw,
        setAt: Date.now(),
      });
      if (!pin) return null;
      current = pin;
      save();
      return pin;
    },
    setLocked(locked) {
      if (!current) return null;
      current = { ...current, locked: Boolean(locked) };
      save();
      return current;
    },
    clear() {
      current = null;
      save();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/**
 * Zoom-lock math: the new camera-to-pin distance for one wheel/pinch step.
 * deltaY > 0 zooms out, < 0 zooms in. Each step changes the range by `step`
 * (15% by default), clamped to [min, max] metres.
 */
export function lockedZoomRange(
  range,
  deltaY,
  { step = 0.15, min = 30, max = 2.0e7 } = {},
) {
  if (!Number.isFinite(range) || range <= 0) return min;
  if (!deltaY) return Math.min(Math.max(range, min), max);
  const factor = deltaY > 0 ? 1 + step : 1 / (1 + step);
  return Math.min(Math.max(range * factor, min), max);
}
