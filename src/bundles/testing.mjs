// Test helpers for optional Data Bundles. A test that reads a bundle's files
// skips cleanly when that bundle is not installed (npm run bundle -- add <id>).
import { existsSync, readFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);

/** True when every payload file of bundle `id` is present. */
export function bundleInstalled(id) {
  const manifestUrl = new URL(`bundles/${id}/bundle.json`, ROOT);
  if (!existsSync(manifestUrl)) return false;
  const files =
    JSON.parse(readFileSync(manifestUrl, 'utf8')).source?.files ?? [];
  return files.every((f) => existsSync(new URL(f.to, ROOT)));
}

/** node:test options that skip when bundle `id` is missing. */
export function needsBundle(id, options = {}) {
  return bundleInstalled(id)
    ? options
    : { ...options, skip: `optional bundle "${id}" not installed` };
}

/** Wrap `test` so every test in a file skips when bundle `id` is missing. */
export function gateOnBundle(test, id) {
  if (bundleInstalled(id)) return test;
  const gated = (name, options, fn) => {
    if (typeof options === 'function') [fn, options] = [options, {}];
    return test(name, needsBundle(id, options), fn);
  };
  return Object.assign(gated, test);
}
