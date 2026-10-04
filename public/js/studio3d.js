// Lumea — Studio coupe 3D. A parametric head: hair and beard are displaced shells over the scalp,
// driven by lengths in centimetres (top, sides, nape, fringe), fade height, volume and curl.
import * as THREE from '/vendor/three.module.min.js';

const CM_PER_UNIT = 9.5; // head radius ≈ 9.5 cm
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;

// Small deterministic 3D value noise (for curls and colour variation).
function hash(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise3(x, y, z) {
  const xi = Math.floor(x); const yi = Math.floor(y); const zi = Math.floor(z);
  const xf = x - xi; const yf = y - yi; const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf); const v = yf * yf * (3 - 2 * yf); const w = zf * zf * (3 - 2 * zf);
  let out = 0;
  for (let dx = 0; dx <= 1; dx++) for (let dy = 0; dy <= 1; dy++) for (let dz = 0; dz <= 1; dz++) {
    out += hash(xi + dx, yi + dy, zi + dz) * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
  }
  return out * 2 - 1;
}

const FADE_LINE = { none: -9, low: -0.3, mid: 0.0, high: 0.28, skin: 0.1 };

/** Hair length (cm) and placement for a scalp direction n (unit sphere, +z = face, +y = up). */
function hairAt(n, p) {
  const ax = Math.abs(n.x);
  // Hairline: high on the forehead, lower at the temples, down to the nape at the back.
  const front = smooth(-0.1, 0.45, n.z);
  const hairline = mix(-0.52, 0.47 - 0.42 * ax * ax, front);
  let mask = smooth(hairline - 0.02, hairline + 0.07, n.y);
  // Keep ears clear for short hair.
  const ear = smooth(0.78, 0.9, ax) * smooth(0.24, 0.08, Math.abs(n.y + 0.02)) * smooth(0.3, 0.12, Math.abs(n.z + 0.02));
  const wTop = smooth(0.3, 0.72, n.y);
  const wBack = (1 - wTop) * smooth(0.15, -0.45, n.z);
  const wSide = Math.max(0, 1 - wTop - wBack);
  let top = p.top;
  if (p.mohawk) top *= smooth(0.32, 0.14, ax);
  let sideBack = (p.sides * wSide + p.back * wBack) / Math.max(1e-4, wSide + wBack);
  if (p.fade !== 'none') {
    const line = FADE_LINE[p.fade] ?? 0;
    const k = smooth(line - 0.42, line + 0.05, n.y);
    sideBack *= p.fade === 'skin' ? k : 0.2 + 0.8 * k;
  }
  const L = top * wTop + sideBack * (1 - wTop);
  if (L < 2.5) mask *= 1 - ear;
  const fringeZone = smooth(0.35, 0.8, n.z) * smooth(0.15, 0.55, n.y) * smooth(0.75, 0.3, ax);
  return { L, mask, wTop, fringeZone };
}

function beardAt(n, style) {
  if (style === 'none') return 0;
  const ax = Math.abs(n.x);
  const lower = smooth(-0.12, -0.3, n.y + 0.08 * smooth(0.5, 0.9, ax)) * smooth(-0.35, 0.15, n.z);
  const sideburn = smooth(0.72, 0.86, ax) * smooth(0.12, -0.05, n.y) * smooth(-0.25, 0.05, n.z);
  const lips = smooth(0.26, 0.18, ax) * smooth(0.12, 0.04, Math.abs(n.y + 0.43)) * smooth(0.75, 0.9, n.z);
  const moustache = smooth(0.34, 0.2, ax) * smooth(0.06, 0.02, Math.abs(n.y + 0.33)) * smooth(0.8, 0.92, n.z);
  if (style === 'moustache') return moustache;
  if (style === 'goatee') return Math.max(moustache, smooth(0.3, 0.16, ax) * smooth(-0.42, -0.55, n.y) * smooth(0.2, 0.6, n.z)) * (1 - lips);
  return Math.max(Math.max(lower, sideburn) * (1 - lips), moustache);
}

export function createStudio(container, { params, skin = '#e0ac8b', autoRotate = true } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);
  renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;cursor:grab';

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 0.15, 7.6);
  camera.lookAt(0, -0.32, 0);

  scene.add(new THREE.HemisphereLight(0xfff4ea, 0x3a3440, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(3, 4, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xbfd4ff, 1.4);
  rim.position.set(-4, 2, -4);
  scene.add(rim);

  const root = new THREE.Group();
  root.rotation.y = -0.55;
  scene.add(root);
  const head = new THREE.Group();
  head.scale.set(0.86, 1.08, 0.98);
  root.add(head);

  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.62, metalness: 0 });
  head.add(new THREE.Mesh(new THREE.SphereGeometry(1, 96, 72), skinMat));

  const onSurface = (x, y, z, r = 1) => new THREE.Vector3(x, y, z).normalize().multiplyScalar(r);
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1716, roughness: 0.3 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf4efe9, roughness: 0.25 });
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.11, 24, 16), white);
    eye.position.copy(onSurface(0.34 * sx, 0.1, 0.92, 0.94));
    eye.scale.set(1, 0.7, 0.6);
    head.add(eye);
    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), dark);
    iris.position.copy(onSurface(0.34 * sx, 0.1, 0.92, 1.0));
    head.add(iris);
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 16), skinMat);
    ear.position.set(0.99 * sx, -0.02, -0.02);
    ear.scale.set(0.45, 1.15, 0.8);
    head.add(ear);
  }
  const browMat = new THREE.MeshStandardMaterial({ color: 0x3b2417, roughness: 0.8 });
  for (const sx of [-1, 1]) {
    const brow = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.2, 4, 8), browMat);
    brow.position.copy(onSurface(0.34 * sx, 0.27, 0.9, 1.0));
    brow.rotation.z = Math.PI / 2 + 0.12 * sx;
    head.add(brow);
  }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 16), skinMat);
  nose.position.set(0, -0.12, 0.98);
  nose.scale.set(0.7, 1.2, 1);
  head.add(nose);
  const lipMat = new THREE.MeshStandardMaterial({ color: 0xb06a62, roughness: 0.5 });
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 12), lipMat);
  mouth.position.copy(onSurface(0, -0.43, 0.9, 0.97));
  mouth.scale.set(1.25, 0.32, 0.5);
  head.add(mouth);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.46, 1.1, 40), skinMat);
  neck.position.set(0, -1.35, -0.05);
  root.add(neck);
  const shirt = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.MeshStandardMaterial({ color: 0x2c2a33, roughness: 0.85 }));
  shirt.position.set(0, -2.25, -0.05);
  shirt.scale.set(1.9, 0.75, 0.95);
  root.add(shirt);

  // Hair & beard shells share the head's sphere topology.
  const hairGeo = new THREE.SphereGeometry(1, 180, 140);
  const base = hairGeo.attributes.position.array.slice();
  hairGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(base.length), 3));
  const hairMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.58, metalness: 0.04 });
  const hair = new THREE.Mesh(hairGeo, hairMat);
  head.add(hair);

  const beardGeo = new THREE.SphereGeometry(1, 140, 110);
  const beardBase = beardGeo.attributes.position.array.slice();
  beardGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(beardBase.length), 3));
  const beard = new THREE.Mesh(beardGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }));
  head.add(beard);

  const n = new THREE.Vector3();
  const cHair = new THREE.Color();
  const cSkin = new THREE.Color();
  const cOut = new THREE.Color();
  let current = { ...params };

  function build(p) {
    cHair.set(p.color || '#3b2417');
    cSkin.set(skinMat.color).multiplyScalar(0.82);
    browMat.color.set(p.color || '#3b2417');
    const pos = hairGeo.attributes.position.array;
    const col = hairGeo.attributes.color.array;
    for (let i = 0; i < pos.length; i += 3) {
      n.set(base[i], base[i + 1], base[i + 2]);
      const { L, mask, wTop, fringeZone } = hairAt(n, p);
      const shellCm = Math.min(L, 4.5) + (p.curl > 0.5 ? Math.min(L, 9) * p.curl * 0.5 : 0);
      let t = 0.012 + (shellCm / CM_PER_UNIT) * 0.6;
      t += p.volume * 0.38 * wTop * smooth(-0.3, 0.7, n.z) * smooth(1, 4, L);
      const curlAmp = p.curl * (0.025 + Math.min(L, 12) * 0.006);
      if (curlAmp) t += noise3(n.x * 7, n.y * 7, n.z * 7) * curlAmp;
      // Long hair falls down the sides and back; in front it is swept away from the face (the fringe slider covers the forehead).
      const faceClear = 1 - smooth(0.15, 0.55, n.z) * smooth(0.8, 0.4, Math.abs(n.x));
      const hangCm = Math.max(0, L - 4.5) * (1 - wTop * 0.85) * faceClear;
      const hang = (hangCm / CM_PER_UNIT) * 0.62;
      const fringe = (p.fringe / CM_PER_UNIT) * 0.55 * fringeZone;
      let x = n.x * (1 + t);
      let y = n.y * (1 + t) - hang - fringe * 0.9;
      let z = n.z * (1 + t) + fringe * 0.35;
      // Hanging hair falls straight: pull it slightly out so it clears the face and shoulders.
      if (hang > 0) {
        const out = Math.min(hang, 0.6) * 0.18;
        x += n.x * out; z += (n.z < 0.3 ? n.z : 0.3) * out;
      }
      const inside = 0.975;
      pos[i] = mix(n.x * inside, x, mask);
      pos[i + 1] = mix(n.y * inside, y, mask);
      pos[i + 2] = mix(n.z * inside, z, mask);
      const density = smooth(0, 0.9, L);
      cOut.copy(cSkin).lerp(cHair, density);
      const v = 1 + noise3(n.x * 40, n.y * 40, n.z * 40) * 0.09 + noise3(n.x * 9, n.y * 9, n.z * 9) * 0.05;
      col[i] = cOut.r * v; col[i + 1] = cOut.g * v; col[i + 2] = cOut.b * v;
    }
    hairGeo.attributes.position.needsUpdate = true;
    hairGeo.attributes.color.needsUpdate = true;
    hairGeo.computeVertexNormals();

    const bpos = beardGeo.attributes.position.array;
    const bcol = beardGeo.attributes.color.array;
    const style = p.beard || 'none';
    const lenByStyle = { stubble: 0.008, short: 0.035, full: 0.07, goatee: 0.05, moustache: 0.035 };
    const L = lenByStyle[style] || 0;
    const tint = style === 'stubble' ? 0.45 : 1;
    beard.visible = style !== 'none';
    for (let i = 0; i < bpos.length; i += 3) {
      n.set(beardBase[i], beardBase[i + 1], beardBase[i + 2]);
      const m = beardAt(n, style);
      const chin = style === 'full' ? smooth(-0.55, -0.9, n.y) * 0.16 : 0;
      const t = L * (0.6 + 0.4 * m) + noise3(n.x * 18, n.y * 18, n.z * 18) * L * 0.12;
      bpos[i] = mix(n.x * 0.97, n.x * (1 + t), m);
      bpos[i + 1] = mix(n.y * 0.97, n.y * (1 + t) - chin, m);
      bpos[i + 2] = mix(n.z * 0.97, n.z * (1 + t) + chin * 0.25, m);
      cOut.copy(cSkin).lerp(cHair, Math.min(1, m * tint * 1.2));
      const v = 1 + noise3(n.x * 45, n.y * 45, n.z * 45) * 0.12;
      bcol[i] = cOut.r * v; bcol[i + 1] = cOut.g * v; bcol[i + 2] = cOut.b * v;
    }
    beardGeo.attributes.position.needsUpdate = true;
    beardGeo.attributes.color.needsUpdate = true;
    beardGeo.computeVertexNormals();
  }

  // Interaction: drag to turn the head, wheel / pinch to zoom.
  let dragging = false; let lastX = 0; let lastY = 0; let idle = autoRotate; let targetY = root.rotation.y;
  const el = renderer.domElement;
  el.addEventListener('pointerdown', (e) => { dragging = true; idle = false; lastX = e.clientX; lastY = e.clientY; el.setPointerCapture(e.pointerId); el.style.cursor = 'grabbing'; });
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    targetY += (e.clientX - lastX) * 0.012;
    root.rotation.x = Math.max(-0.35, Math.min(0.35, root.rotation.x + (e.clientY - lastY) * 0.006));
    lastX = e.clientX; lastY = e.clientY;
  });
  el.addEventListener('pointerup', () => { dragging = false; el.style.cursor = 'grab'; });
  el.addEventListener('wheel', (e) => { e.preventDefault(); camera.position.z = Math.max(4.6, Math.min(9, camera.position.z + e.deltaY * 0.004)); }, { passive: false });

  function resize() {
    const w = container.clientWidth || 300;
    const h = container.clientHeight || w;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  let raf;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clock = new THREE.Clock();
  function loop() {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, clock.getDelta());
    if (idle && !reduced) targetY += dt * 0.35;
    root.rotation.y += (targetY - root.rotation.y) * Math.min(1, dt * 8);
    renderer.render(scene, camera);
  }
  build(current);
  loop();

  return {
    update(p) { current = { ...current, ...p }; build(current); },
    setSkin(hex) { skinMat.color.set(hex); build(current); },
    view(name) {
      idle = false;
      const angles = { face: 0, profil: Math.PI / 2, dos: Math.PI, troisquarts: -0.6 };
      const a = angles[name] ?? 0;
      targetY = a + Math.round((root.rotation.y - a) / (Math.PI * 2)) * Math.PI * 2;
      root.rotation.x = 0;
    },
    /** JPEG snapshot (3/4 view) to attach to the booking. */
    snapshot(size = 360) {
      const prev = { y: root.rotation.y, x: root.rotation.x, t: targetY };
      root.rotation.set(0, -0.55, 0);
      const w = renderer.domElement.width; const h = renderer.domElement.height;
      renderer.setPixelRatio(1);
      renderer.setSize(size, size, false);
      camera.aspect = 1; camera.updateProjectionMatrix();
      scene.background = new THREE.Color(0xf3efe9);
      renderer.render(scene, camera);
      const url = renderer.domElement.toDataURL('image/jpeg', 0.82);
      scene.background = null;
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.setSize(w / renderer.getPixelRatio(), h / renderer.getPixelRatio(), false);
      resize();
      root.rotation.set(prev.x, prev.y, 0); targetY = prev.t;
      return url;
    },
    dispose() {
      cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose();
      hairGeo.dispose(); beardGeo.dispose(); el.remove();
    },
  };
}
