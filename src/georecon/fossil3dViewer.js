// 3D fossil viewer: a ghosted reference specimen with a fragment placed inside it.
// Vendored from the Geo Recon fossil3d workspace (viewer/src/fossil3d.js).
// Loaded lazily by fossil3dBundle.js so three.js only downloads when a
// fossil pop-up has a matching model.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';

const THEME = {
  bg: 0x000000,
  ghost: 0x6b7a86,
  edge: 0x2b3640,
  cyan: 0x00e5ff,
  text: '#00e5ff',
};

/**
 * @param {HTMLElement} container  sized element to render into
 * @param {object} opts
 * @param {string} opts.referenceUrl  GLB of the whole reference specimen
 * @param {string} [opts.fragmentUrl] PLY/GLB of the fragment (its own coordinates)
 * @param {string|object} [opts.result] register.py result.json (URL or object);
 *   its transform_fragment_to_reference places the fragment
 * @param {object} [opts.referenceMeta] reference.json (URL or object) for the label
 * @param {string} [opts.note] extra HUD line
 * @returns {Promise<{dispose(): void}>}
 */
export async function mountFossil3D(container, opts) {
  const json = async (v) =>
    typeof v === 'string' ? (await fetch(v)).json() : v;
  const [result, meta] = await Promise.all([
    json(opts.result),
    json(opts.referenceMeta),
  ]);

  const w = container.clientWidth || 640,
    h = container.clientHeight || 480;
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: !!opts.preserveDrawingBuffer,
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(w, h);
  renderer.setClearColor(THEME.bg);
  container.style.position ||= 'relative';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, w / h, 0.0001, 100);
  scene.add(new THREE.HemisphereLight(0xcfe9ff, 0x101418, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(1, 2, 1.5);
  scene.add(key);

  // reference: semi-transparent gunmetal + faint edge lines
  const gltf = await new GLTFLoader().loadAsync(opts.referenceUrl);
  const ref = gltf.scene;
  ref.traverse((o) => {
    if (!o.isMesh) return;
    o.material = new THREE.MeshStandardMaterial({
      color: THEME.ghost,
      metalness: 0.6,
      roughness: 0.45,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    o.renderOrder = 2;
    const e = new THREE.LineSegments(
      new THREE.EdgesGeometry(o.geometry, 35),
      new THREE.LineBasicMaterial({
        color: THEME.edge,
        transparent: true,
        opacity: 0.5,
      }),
    );
    o.add(e);
  });
  scene.add(ref);

  let frag = null;
  if (opts.fragmentUrl) {
    let geom;
    if (/\.ply$/i.test(opts.fragmentUrl)) {
      geom = await new PLYLoader().loadAsync(opts.fragmentUrl);
      geom.computeVertexNormals();
    } else {
      const g = await new GLTFLoader().loadAsync(opts.fragmentUrl);
      g.scene.traverse((o) => {
        if (o.isMesh && !geom) geom = o.geometry;
      });
    }
    frag = new THREE.Mesh(
      geom,
      new THREE.MeshStandardMaterial({
        color: THEME.cyan,
        emissive: THEME.cyan,
        emissiveIntensity: 0.35,
        metalness: 0.2,
        roughness: 0.5,
        side: THREE.DoubleSide,
      }),
    );
    frag.renderOrder = 1;
    if (result?.transform_fragment_to_reference) {
      const m = new THREE.Matrix4();
      m.set(...result.transform_fragment_to_reference.flat()); // row-major in JSON
      frag.matrixAutoUpdate = false;
      frag.matrix.copy(m);
    }
    scene.add(frag);
  }

  // frame the reference
  const box = new THREE.Box3().setFromObject(ref);
  const size = box.getSize(new THREE.Vector3()).length();
  const centre = box.getCenter(new THREE.Vector3());
  camera.position
    .copy(centre)
    .add(new THREE.Vector3(0.5, 0.6, 0.9).multiplyScalar(size));
  camera.near = size / 1000;
  camera.far = size * 50;
  camera.updateProjectionMatrix();
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(centre);
  controls.enableDamping = true;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.8;
  controls.addEventListener('start', () => (controls.autoRotate = false));

  // HUD label
  const hud = document.createElement('div');
  hud.style.cssText = `position:absolute;left:8px;top:8px;right:8px;pointer-events:none;
    font:12px/1.4 ui-monospace,Menlo,monospace;color:${THEME.text};
    text-shadow:0 0 6px rgba(0,229,255,.6);overflow:hidden;`;
  const line = (t, dim) => {
    const d = document.createElement('div');
    d.textContent = t;
    d.style.cssText = `white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${dim ? 'opacity:.65' : ''}`;
    d.title = t;
    return d;
  };
  if (result) {
    hud.append(line(`FRAGMENT FIT :: ${result.region}`));
    hud.append(
      line(
        `CONFIDENCE ${Math.round(result.confidence * 100)}% (${result.confidence_label}) · inliers ${Math.round(result.inlier_fraction * 100)}% · uniqueness ${Math.round(result.uniqueness * 100)}%`,
        true,
      ),
    );
  }
  if (meta) {
    hud.append(
      line(`REFERENCE :: ${meta.taxon} — match: ${meta.match_level}`, true),
    );
    hud.append(line(`${meta.license} · ${meta.source}`, true));
  }
  if (opts.note) hud.append(line(opts.note)); // e.g. marks a synthetic demo
  container.appendChild(hud);

  let raf = 0;
  const tick = () => {
    controls.update();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  };
  tick();
  const ro = new ResizeObserver(() => {
    const W = container.clientWidth,
      H = container.clientHeight;
    if (!W || !H) return;
    renderer.setSize(W, H);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
  });
  ro.observe(container);

  return {
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      scene.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose?.();
      });
      renderer.dispose();
      renderer.domElement.remove();
      hud.remove();
    },
  };
}
