// Scroll-driven 3D story: a house in the Dolomites, from the empty site to the lit home.
// Timeline t goes from 0 to 6 (one unit per chapter):
//   0 site · 1 sketch · 2 plan · 3 structure · 4 envelope · 5 light · 6 home
import * as THREE from '../vendor/three.module.min.js';

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (v) => { const x = clamp(v); return x * x * (3 - 2 * x); };
const range = (t, a, b) => smooth((t - a) / (b - a));
const lerp = (a, b, k) => a + (b - a) * k;

// --- small deterministic noise -------------------------------------------------
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
function vnoise(x, y) {
  const xi = Math.floor(x); const yi = Math.floor(y); const xf = x - xi; const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf); const v = yf * yf * (3 - 2 * yf);
  return lerp(lerp(hash(xi, yi), hash(xi + 1, yi), u), lerp(hash(xi, yi + 1), hash(xi + 1, yi + 1), u), v);
}
const fbm = (x, y, o = 5) => { let a = 0; let f = 1; let amp = 0.5; for (let i = 0; i < o; i++) { a += amp * vnoise(x * f, y * f); f *= 2.03; amp *= 0.5; } return a; };
const ridged = (x, y) => { let a = 0; let f = 1; let amp = 0.55; for (let i = 0; i < 5; i++) { a += amp * (1 - Math.abs(vnoise(x * f, y * f) * 2 - 1)) ** 2; f *= 2.1; amp *= 0.5; } return a; };

// --- palette --------------------------------------------------------------------
const C = {
  skyDay: new THREE.Color('#dfe6ea'), skyDusk: new THREE.Color('#2a2f45'), fogDusk: new THREE.Color('#3a3a52'),
  meadow: new THREE.Color('#8d9a6a'), meadowDark: new THREE.Color('#5f6b48'), rock: new THREE.Color('#b9b2a6'), rockDark: new THREE.Color('#7d776d'), snow: new THREE.Color('#f4f3ef'),
  ink: new THREE.Color('#1f1d1a'), blue: new THREE.Color('#2f5fd0'), concrete: new THREE.Color('#bdb8ae'), stone: new THREE.Color('#9e968a'),
  larch: new THREE.Color('#a8673a'), larchDark: new THREE.Color('#6f4224'), roof: new THREE.Color('#3b3936'), glass: new THREE.Color('#9fb3bf'), warm: new THREE.Color('#ffb466'),
};

// --- house dimensions -------------------------------------------------------------
const W = 13; const D = 8.5; const H1 = 3.1; const H2 = 3; const RIDGE = 3.6; const OVER = 1.2;
const TOP = H1 + H2;

/** A wooden cladding texture (vertical larch boards), drawn on a canvas. */
function larchTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  const r = rng(7);
  for (let x = 0; x < 256; x += 16) {
    const l = 0.82 + r() * 0.3;
    g.fillStyle = `rgb(${Math.round(168 * l)},${Math.round(103 * l)},${Math.round(58 * l)})`;
    g.fillRect(x, 0, 16, 256);
    g.fillStyle = 'rgba(40,20,8,.55)'; g.fillRect(x + 15, 0, 1, 256);
    for (let i = 0; i < 6; i++) { g.fillStyle = `rgba(60,30,10,${0.08 + r() * 0.1})`; g.fillRect(x + 2 + r() * 11, r() * 256, 1, 40 + r() * 120); }
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
function stoneTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d'); const r = rng(3);
  g.fillStyle = '#8f877c'; g.fillRect(0, 0, 256, 256);
  let y = 0;
  while (y < 256) {
    const h = 18 + r() * 20; let x = -r() * 30;
    while (x < 256) {
      const w = 30 + r() * 45; const l = 0.8 + r() * 0.35;
      g.fillStyle = `rgb(${Math.round(170 * l)},${Math.round(162 * l)},${Math.round(150 * l)})`;
      g.beginPath(); g.roundRect(x + 2, y + 2, w - 4, h - 4, 5); g.fill();
      x += w;
    }
    y += h;
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createStory(canvas, { onReady } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = C.skyDay.clone();
  scene.fog = new THREE.Fog(C.skyDay.clone(), 180, 720);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 900);

  // Lights
  const hemi = new THREE.HemisphereLight(0xeef3ff, 0x6b5a45, 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
  sun.position.set(-40, 60, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 10, far: 160 });
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  const interior = new THREE.PointLight(0xffa860, 0, 30, 1.6);
  interior.position.set(0, H1 * 0.6, 0);
  scene.add(interior);
  const interior2 = new THREE.PointLight(0xffa860, 0, 26, 1.6);
  interior2.position.set(2, H1 + H2 * 0.5, 0);
  scene.add(interior2);

  // --- terrain ----------------------------------------------------------------
  const SIZE = 420; const SEG = 180;
  const terrainGeo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  terrainGeo.rotateX(-Math.PI / 2);
  const pos = terrainGeo.attributes.position;
  const base = new Float32Array(pos.count);
  const padMask = new Float32Array(pos.count);
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i); const z = pos.getZ(i);
    const dist = Math.hypot(x, z);
    // gentle meadow slope near the site, rising into the valley sides
    let h = (fbm(x * 0.018, z * 0.018) - 0.45) * 9 + Math.max(0, dist - 60) ** 1.35 * 0.06 + z * -0.04;
    const pad = 1 - smooth((Math.max(Math.abs(x) - W / 2 - 4, 0) + Math.max(Math.abs(z) - D / 2 - 4, 0)) / 9);
    base[i] = h; padMask[i] = pad;
    pos.setY(i, h);
    const k = clamp(fbm(x * 0.05 + 9, z * 0.05) * 1.4 - 0.2);
    const col = C.meadow.clone().lerp(C.meadowDark, k);
    colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
  }
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terrainGeo.computeVertexNormals();
  const terrain = new THREE.Mesh(terrainGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: false }));
  terrain.receiveShadow = true;
  scene.add(terrain);
  // pad level = average height at the centre
  const padLevel = 0;
  function levelPad(k) {
    for (let i = 0; i < pos.count; i++) if (padMask[i] > 0) pos.setY(i, lerp(base[i], padLevel - 0.02, padMask[i] * k));
    pos.needsUpdate = true;
    terrainGeo.computeVertexNormals();
  }
  // shift the whole house so that it sits on the levelled pad
  let lastPad = -1;

  // --- Dolomites: a mountain range around the valley (height field on a ring) ---
  const ringGeo = new THREE.RingGeometry(195, 470, 300, 60);
  ringGeo.rotateX(-Math.PI / 2);
  const rp = ringGeo.attributes.position;
  for (let i = 0; i < rp.count; i++) {
    const x = rp.getX(i); const z = rp.getZ(i); const d = Math.hypot(x, z);
    const rise = smooth((d - 195) / 110);
    const north = 0.75 + 0.55 * Math.max(0, -z / d); // the range behind the house is the highest
    let h = ridged(x * 0.0085 + 3, z * 0.0085) ** 1.7 * 240 * north;
    h = lerp(h, Math.round(h / 38) * 38, 0.35); // ledges and vertical walls, Dolomite-style
    rp.setY(i, 20 + rise * (h + (d - 195) * 0.25) + (fbm(x * 0.05, z * 0.05) - 0.5) * 14);
  }
  const ring = ringGeo.toNonIndexed();
  ring.computeVertexNormals();
  const rn = ring.attributes.normal; const rpos = ring.attributes.position;
  const rcol = new Float32Array(rpos.count * 3);
  for (let i = 0; i < rpos.count; i += 3) {
    const y = (rpos.getY(i) + rpos.getY(i + 1) + rpos.getY(i + 2)) / 3;
    const ny = rn.getY(i);
    const x = rpos.getX(i); const z = rpos.getZ(i);
    let c;
    if (y > 150 + vnoise(x * 0.03, z * 0.03) * 70 && ny > 0.55) c = C.snow;
    else if (y < 55 && ny > 0.7) c = C.meadowDark;
    else c = C.rock.clone().lerp(C.rockDark, clamp((0.9 - ny) * 1.4 + (vnoise(x * 0.04, y * 0.05) - 0.5) * 0.5));
    for (let k = 0; k < 3; k++) { rcol[(i + k) * 3] = c.r; rcol[(i + k) * 3 + 1] = c.g; rcol[(i + k) * 3 + 2] = c.b; }
  }
  ring.setAttribute('color', new THREE.BufferAttribute(rcol, 3));
  const mountains = new THREE.Mesh(ring, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
  scene.add(mountains);

  // --- forest (instanced firs and larches) --------------------------------------
  const treeGeo = new THREE.ConeGeometry(1.6, 7, 7); treeGeo.translate(0, 4.2, 0);
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.3, 1.4, 6); trunkGeo.translate(0, 0.7, 0);
  const N = 420;
  const trees = new THREE.InstancedMesh(treeGeo, new THREE.MeshStandardMaterial({ color: '#3f5236', roughness: 0.9, flatShading: true }), N);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: '#4b3426' }), N);
  trees.castShadow = true;
  const r = rng(11); const m4 = new THREE.Matrix4(); const q = new THREE.Quaternion(); const sc = new THREE.Vector3(); const p3 = new THREE.Vector3();
  let placed = 0;
  while (placed < N) {
    const a = r() * Math.PI * 2; const d = 24 + r() ** 0.7 * 150;
    const x = Math.cos(a) * d; const z = Math.sin(a) * d;
    if (x > -45 && x < 95 && z > -14 && z < 170) continue; // keep the meadow in front of the house open
    if (Math.abs(x) < 26 && z > -14) continue;
    if (fbm(x * 0.03, z * 0.03 + 4) < 0.45) continue; // clusters
    const s = 0.7 + r() * 0.9;
    const y = (fbm(x * 0.018, z * 0.018) - 0.45) * 9 + Math.max(0, Math.hypot(x, z) - 60) ** 1.35 * 0.06 + z * -0.04;
    m4.compose(p3.set(x, y - 0.2, z), q, sc.set(s, s * (0.9 + r() * 0.4), s));
    trees.setMatrixAt(placed, m4); trunks.setMatrixAt(placed, m4);
    trees.setColorAt(placed, new THREE.Color().setHSL(0.27 + r() * 0.06, 0.25, 0.22 + r() * 0.1));
    placed++;
  }
  scene.add(trees, trunks);

  // --- the house ---------------------------------------------------------------
  const house = new THREE.Group();
  scene.add(house);
  const parts = []; // { obj, a, b, mode }
  const mat = (o) => new THREE.MeshStandardMaterial({ roughness: 0.8, transparent: true, ...o });
  const glassMat = mat({ color: C.glass, roughness: 0.08, metalness: 0.2, opacity: 0.55, emissive: C.warm, emissiveIntensity: 0 });
  function add(obj, a, b, mode = 'rise') {
    // each part gets its own material copy so it can fade in on its own
    obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material !== glassMat) o.material = o.material.clone(); } });
    obj.userData.home = obj.position.clone();
    house.add(obj);
    parts.push({ obj, a, b, mode });
    return obj;
  }
  const box = (w, h, d, material, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(0, h / 2, 0); const m = new THREE.Mesh(g, material); m.position.set(x, y, z); return m; };

  // 3 · structure
  const concrete = mat({ color: C.concrete, roughness: 0.95 });
  add(box(W + 0.6, 0.45, D + 0.6, concrete, 0, -0.3, 0), 3.0, 3.25, 'rise');
  const steel = mat({ color: '#6c6a66', roughness: 0.5, metalness: 0.4 });
  const glulam = mat({ color: '#c99a6b', roughness: 0.7 });
  const postsX = [-W / 2, -W / 6, W / 6, W / 2]; const postsZ = [-D / 2, D / 2];
  let n = 0;
  for (const x of postsX) for (const z of postsZ) { add(box(0.32, H1, 0.32, glulam, x, 0.15, z), 3.25 + n * 0.04, 3.45 + n * 0.04, 'grow'); n++; }
  for (const z of postsZ) add(box(W + 0.3, 0.42, 0.34, glulam, 0, H1 + 0.15, z), 3.5, 3.65, 'drop');
  for (const x of postsX) add(box(0.34, 0.42, D + 0.3, glulam, x, H1 + 0.15, 0), 3.55, 3.7, 'drop');
  n = 0;
  for (const x of postsX) for (const z of postsZ) { add(box(0.28, H2, 0.28, glulam, x, H1 + 0.57, z), 3.65 + n * 0.03, 3.82 + n * 0.03, 'grow'); n++; }
  // rafters (gable roof, ridge along X)
  const rafterLen = Math.hypot(D / 2 + OVER, RIDGE);
  const pitch = Math.atan2(RIDGE, D / 2 + OVER);
  for (let i = 0; i <= 8; i++) {
    const x = -W / 2 - OVER + ((W + OVER * 2) / 8) * i;
    for (const side of [-1, 1]) {
      const g = new THREE.BoxGeometry(0.2, 0.32, rafterLen); g.translate(0, 0, side * rafterLen / 2);
      const m = new THREE.Mesh(g, glulam);
      m.position.set(x, TOP + 0.6 + RIDGE, 0);
      m.rotation.x = side * pitch;
      add(m, 3.8 + i * 0.015, 3.95 + i * 0.015, 'drop');
    }
  }
  add(box(W + OVER * 2, 0.36, 0.3, glulam, 0, TOP + 0.45 + RIDGE, 0), 3.82, 3.96, 'drop');

  // 4 · envelope
  const stoneMat = mat({ map: stoneTexture(), roughness: 0.95 }); stoneMat.map.repeat.set(3, 1);
  const larch = larchTexture();
  const woodMat = mat({ map: larch, roughness: 0.85 }); larch.repeat.set(4, 1);
  const frameMat = mat({ color: '#2a2724', roughness: 0.6 });

  function wallWithOpenings(len, h, thick, material, openings) {
    // openings: [{ from, to, y0, y1 }] along the wall length (from 0..len)
    const g = new THREE.Group();
    const cuts = openings.slice().sort((a, b) => a.from - b.from);
    let cursor = 0;
    const piece = (x0, x1, y0, y1) => {
      if (x1 - x0 < 0.01 || y1 - y0 < 0.01) return;
      const geo = new THREE.BoxGeometry(x1 - x0, y1 - y0, thick);
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (x0 + uv.getX(i) * (x1 - x0)) / 3, (y0 + uv.getY(i) * (y1 - y0)) / 3);
      const m = new THREE.Mesh(geo, material); m.position.set((x0 + x1) / 2 - len / 2, (y0 + y1) / 2, 0);
      g.add(m);
    };
    for (const o of cuts) {
      piece(cursor, o.from, 0, h);
      piece(o.from, o.to, 0, o.y0);
      piece(o.from, o.to, o.y1, h);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(o.to - o.from, o.y1 - o.y0, 0.06), glassMat);
      glass.position.set((o.from + o.to) / 2 - len / 2, (o.y0 + o.y1) / 2, 0);
      glass.userData.glass = true;
      g.add(glass);
      const fr = new THREE.Mesh(new THREE.BoxGeometry(o.to - o.from + 0.12, 0.1, thick + 0.06), frameMat);
      fr.position.set(glass.position.x, o.y0, 0); g.add(fr);
      cursor = o.to;
    }
    piece(cursor, len, 0, h);
    return g;
  }
  const T = 0.4;
  // ground floor: stone, big glazing to the south (+z)
  const gfSouth = wallWithOpenings(W, H1, T, stoneMat, [{ from: 1.2, to: 5.6, y0: 0.15, y1: 2.6 }, { from: 7.0, to: 11.6, y0: 0.15, y1: 2.6 }]);
  gfSouth.position.set(0, 0.15, D / 2); add(gfSouth, 4.0, 4.18, 'rise');
  const gfNorth = wallWithOpenings(W, H1, T, stoneMat, [{ from: 2, to: 3.2, y0: 1.0, y1: 2.2 }, { from: 9, to: 10.2, y0: 1.0, y1: 2.2 }]);
  gfNorth.position.set(0, 0.15, -D / 2); add(gfNorth, 4.05, 4.22, 'rise');
  const gfEast = wallWithOpenings(D, H1, T, stoneMat, [{ from: 2.6, to: 5.9, y0: 0.15, y1: 2.6 }]);
  gfEast.rotation.y = Math.PI / 2; gfEast.position.set(W / 2, 0.15, 0); add(gfEast, 4.08, 4.25, 'rise');
  const gfWest = wallWithOpenings(D, H1, T, stoneMat, [{ from: 3.4, to: 5.0, y0: 0.15, y1: 2.4 }]);
  gfWest.rotation.y = Math.PI / 2; gfWest.position.set(-W / 2, 0.15, 0); add(gfWest, 4.1, 4.28, 'rise');
  // floor slab between levels
  add(box(W + 0.5, 0.35, D + 0.5, concrete, 0, H1 + 0.15, 0), 4.25, 4.35, 'drop');
  // upper floor: larch, ribbon window + loggia
  const ufSouth = wallWithOpenings(W, H2, T, woodMat, [{ from: 0.8, to: 4.2, y0: 0.6, y1: 2.6 }, { from: 5.2, to: 12.2, y0: 0.3, y1: 2.7 }]);
  ufSouth.position.set(0, H1 + 0.5, D / 2); add(ufSouth, 4.35, 4.52, 'drop');
  const ufNorth = wallWithOpenings(W, H2, T, woodMat, [{ from: 5.6, to: 7.4, y0: 1.0, y1: 2.4 }]);
  ufNorth.position.set(0, H1 + 0.5, -D / 2); add(ufNorth, 4.4, 4.56, 'drop');
  for (const side of [-1, 1]) {
    const g = new THREE.Group();
    const end = wallWithOpenings(D, H2, T, woodMat, [{ from: 3.2, to: 5.3, y0: 0.5, y1: 2.5 }]);
    g.add(end);
    // gable triangle
    const tri = new THREE.Shape(); tri.moveTo(-D / 2, 0); tri.lineTo(D / 2, 0); tri.lineTo(0, RIDGE); tri.closePath();
    const tg = new THREE.ExtrudeGeometry(tri, { depth: T, bevelEnabled: false }); tg.translate(0, 0, -T / 2);
    const tuv = tg.attributes.uv; for (let i = 0; i < tuv.count; i++) tuv.setXY(i, tuv.getX(i) / 3, tuv.getY(i) / 3);
    const triMesh = new THREE.Mesh(tg, woodMat); triMesh.position.y = H2; g.add(triMesh);
    g.rotation.y = Math.PI / 2; g.position.set(side * W / 2, H1 + 0.5, 0);
    add(g, 4.45 + (side + 1) * 0.03, 4.62 + (side + 1) * 0.03, 'drop');
  }
  // balcony
  add(box(8, 0.18, 1.8, glulam, 2.5, H1 + 0.32, D / 2 + 0.9), 4.6, 4.7, 'drop');
  const rail = new THREE.Group();
  for (let i = 0; i <= 32; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.0, 0.06), glulam); b.position.set(-4 + i * 0.25, 0.5, 0); rail.add(b); }
  const handrail = new THREE.Mesh(new THREE.BoxGeometry(8, 0.08, 0.12), glulam); handrail.position.y = 1.02; rail.add(handrail);
  rail.position.set(2.5, H1 + 0.5, D / 2 + 1.75); add(rail, 4.66, 4.76, 'rise');
  // roof planes
  const roofMat = mat({ color: C.roof, roughness: 0.7, metalness: 0.25 });
  for (const side of [-1, 1]) {
    const g = new THREE.BoxGeometry(W + OVER * 2 + 0.2, 0.22, rafterLen + 0.3); g.translate(0, 0, side * (rafterLen + 0.3) / 2);
    const m = new THREE.Mesh(g, roofMat); m.position.set(0, TOP + 0.85 + RIDGE, 0); m.rotation.x = side * pitch;
    add(m, 4.7 + (side + 1) * 0.04, 4.85 + (side + 1) * 0.04, 'drop');
  }
  // chimney
  add(box(0.8, 2.2, 0.8, stoneMat, -3.5, TOP + RIDGE * 0.45, -1.2), 4.88, 4.96, 'rise');
  // terrace + path
  const deck = mat({ map: larch.clone(), roughness: 0.9 }); deck.map.repeat.set(8, 2); deck.map.rotation = Math.PI / 2;
  add(box(W + 4, 0.12, 3.4, deck, 0, -0.05, D / 2 + 2), 4.9, 5.0, 'rise');

  // interior glow planes behind the glass (visible at night)
  const glowMat = new THREE.MeshBasicMaterial({ color: C.warm, transparent: true, opacity: 0 });
  const glow1 = new THREE.Mesh(new THREE.PlaneGeometry(W - 1, H1 - 0.4), glowMat); glow1.position.set(0, H1 / 2, D / 2 - 1.2); house.add(glow1);
  const glow2 = new THREE.Mesh(new THREE.PlaneGeometry(W - 1, H2 - 0.6), glowMat); glow2.position.set(0, H1 + H2 / 2 + 0.3, D / 2 - 1.2); house.add(glow2);

  // --- 1 · concept sketch (hand-drawn edges of the final volume) ----------------
  function houseEdges() {
    const v = [];
    const L = (a, b) => v.push(...a, ...b);
    const yb = 0; const yt = TOP + 0.6; const yr = yt + RIDGE;
    const x0 = -W / 2; const x1 = W / 2; const z0 = -D / 2; const z1 = D / 2;
    // base rectangle
    L([x0, yb, z0], [x1, yb, z0]); L([x1, yb, z0], [x1, yb, z1]); L([x1, yb, z1], [x0, yb, z1]); L([x0, yb, z1], [x0, yb, z0]);
    // verticals
    for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) L([x, yb, z], [x, yt, z]);
    // eaves + gables + ridge (with overhang)
    L([x0 - OVER, yt - 0.3, z1 + OVER], [x1 + OVER, yt - 0.3, z1 + OVER]); L([x0 - OVER, yt - 0.3, z0 - OVER], [x1 + OVER, yt - 0.3, z0 - OVER]);
    L([x0 - OVER, yr, 0], [x1 + OVER, yr, 0]);
    for (const x of [x0 - OVER, x1 + OVER]) { L([x, yt - 0.3, z0 - OVER], [x, yr, 0]); L([x, yr, 0], [x, yt - 0.3, z1 + OVER]); }
    // floor line + big windows
    L([x0, H1 + 0.4, z1], [x1, H1 + 0.4, z1]);
    for (const [a, b] of [[x0 + 1.2, x0 + 5.6], [x0 + 7, x0 + 11.6]]) { L([a, 0.3, z1], [a, 2.7, z1]); L([b, 0.3, z1], [b, 2.7, z1]); L([a, 2.7, z1], [b, 2.7, z1]); }
    L([x0 + 5.2, H1 + 0.8, z1], [x0 + 12.2, H1 + 0.8, z1]); L([x0 + 5.2, H1 + 3.2, z1], [x0 + 12.2, H1 + 3.2, z1]);
    return v;
  }
  const sketchGroup = new THREE.Group(); house.add(sketchGroup);
  const sketchLines = [];
  const edges = houseEdges();
  for (let k = 0; k < 3; k++) {
    const jr = rng(20 + k);
    const jittered = edges.map((v, i) => v + (jr() - 0.5) * (k === 0 ? 0.05 : 0.22) * (i % 3 === 1 ? 0.5 : 1));
    // extend each stroke a little beyond its ends, like a pencil sketch
    for (let i = 0; i < jittered.length; i += 6) {
      const a = new THREE.Vector3(jittered[i], jittered[i + 1], jittered[i + 2]); const b = new THREE.Vector3(jittered[i + 3], jittered[i + 4], jittered[i + 5]);
      const dir = b.clone().sub(a).normalize().multiplyScalar(0.35 + jr() * 0.5);
      a.sub(dir); b.add(dir);
      jittered.splice(i, 6, a.x, a.y, a.z, b.x, b.y, b.z);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(jittered, 3));
    const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: C.ink, transparent: true, opacity: k === 0 ? 0.9 : 0.35 }));
    l.userData.count = jittered.length / 3;
    sketchGroup.add(l); sketchLines.push(l);
  }

  // --- 2 · plan drawing on the ground -------------------------------------------
  const planGroup = new THREE.Group(); house.add(planGroup);
  const planV = [];
  const P = (x0, z0, x1, z1) => planV.push(x0, 0.06, z0, x1, 0.06, z1);
  const x0 = -W / 2; const x1 = W / 2; const z0 = -D / 2; const z1 = D / 2;
  // outer walls (double line)
  for (const o of [0, 0.4]) { P(x0 + o, z0 + o, x1 - o, z0 + o); P(x1 - o, z0 + o, x1 - o, z1 - o); P(x1 - o, z1 - o, x0 + o, z1 - o); P(x0 + o, z1 - o, x0 + o, z0 + o); }
  // interior partitions
  P(-1.5, z0 + 0.4, -1.5, -0.6); P(-1.5, 0.8, -1.5, z1 - 0.4); P(x0 + 0.4, -0.6, -1.5, -0.6); P(2.5, z0 + 0.4, 2.5, -1); P(2.5, -1, x1 - 0.4, -1);
  // stairs
  for (let i = 0; i < 9; i++) P(-1.5 + 0.3 * i, -0.6, -1.5 + 0.3 * i, -2.2 - 0.0);
  // door swings (quarter arcs)
  const arc = (cx, cz, rr, a0) => { for (let i = 0; i < 8; i++) { const a = a0 + (i / 8) * Math.PI / 2; const b = a0 + ((i + 1) / 8) * Math.PI / 2; P(cx + Math.cos(a) * rr, cz + Math.sin(a) * rr, cx + Math.cos(b) * rr, cz + Math.sin(b) * rr); } };
  arc(-1.5, -0.6, 1.0, Math.PI / 2); arc(2.5, -1, 0.9, 0);
  // dimension lines
  P(x0, z1 + 1.6, x1, z1 + 1.6); P(x0, z1 + 1.3, x0, z1 + 1.9); P(x1, z1 + 1.3, x1, z1 + 1.9);
  P(x1 + 1.6, z0, x1 + 1.6, z1); P(x1 + 1.3, z0, x1 + 1.9, z0); P(x1 + 1.3, z1, x1 + 1.9, z1);
  // furniture hints: table, sofa, bed
  const rect = (a, b, c, d) => { P(a, b, c, b); P(c, b, c, d); P(c, d, a, d); P(a, d, a, b); };
  rect(-5.4, 1.2, -3.2, 2.6); rect(3.4, 1.4, 5.8, 2.3); rect(3.6, -3.6, 5.6, -1.6); rect(-5.6, -3.6, -3.6, -2.2);
  const planGeo = new THREE.BufferGeometry(); planGeo.setAttribute('position', new THREE.Float32BufferAttribute(planV, 3));
  const planLines = new THREE.LineSegments(planGeo, new THREE.LineBasicMaterial({ color: C.blue, transparent: true, opacity: 1 }));
  planGroup.add(planLines);
  const grid = new THREE.GridHelper(40, 40, 0x2f5fd0, 0x2f5fd0);
  grid.material.transparent = true; grid.material.opacity = 0; grid.position.y = 0.03;
  planGroup.add(grid);
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: '#f6f3ec', transparent: true, opacity: 0 }));
  paper.rotation.x = -Math.PI / 2; paper.position.y = 0.02; planGroup.add(paper);

  // --- 0 · survey stakes ---------------------------------------------------------
  const stakes = new THREE.Group(); house.add(stakes);
  const stakeMat = new THREE.MeshStandardMaterial({ color: '#d8432f', roughness: 0.6, transparent: true });
  for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.4, 6), stakeMat); s.position.set(x, 0.7, z); stakes.add(s);
  }
  const tapeG = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x0, 1.1, z0), new THREE.Vector3(x1, 1.1, z0), new THREE.Vector3(x1, 1.1, z1), new THREE.Vector3(x0, 1.1, z1), new THREE.Vector3(x0, 1.1, z0)]);
  const tape = new THREE.Line(tapeG, new THREE.LineDashedMaterial({ color: '#d8432f', dashSize: 0.4, gapSize: 0.25, transparent: true }));
  tape.computeLineDistances(); stakes.add(tape);

  // --- snow ----------------------------------------------------------------------
  const SN = 2600;
  const snowGeo = new THREE.BufferGeometry();
  const sp = new Float32Array(SN * 3); const sr = rng(5);
  for (let i = 0; i < SN; i++) { sp[i * 3] = (sr() - 0.5) * 90; sp[i * 3 + 1] = sr() * 40; sp[i * 3 + 2] = (sr() - 0.5) * 90; }
  snowGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const flake = document.createElement('canvas'); flake.width = flake.height = 32;
  { const g = flake.getContext('2d'); const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32); }
  const snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.32, map: new THREE.CanvasTexture(flake), transparent: true, opacity: 0, depthWrite: false }));
  scene.add(snow);

  // --- camera path ----------------------------------------------------------------
  const keys = [
    // [position, target] per chapter boundary t = 0..6
    [[46, 13, 104], [-20, 22, -250]], // 0 the valley and the Dolomites
    [[30, 14, 44], [0, 2, 0]],      // 1 site
    [[24, 13, 30], [0, 4, 0]],      // 2 sketch
    [[3, 34, 9], [0, 0, 0]],        // 3 plan (top view)
    [[-26, 12, 26], [0, 4, 0]],     // 4 structure
    [[22, 6, 24], [0, 4.5, 0]],     // 5 envelope
    [[26, 5, 36], [-7, 5.5, 4]],    // 6 lit home at dusk (house to the right of the text)
  ];
  const camCurve = new THREE.CatmullRomCurve3(keys.map((k) => new THREE.Vector3(...k[0])), false, 'centripetal');
  const tgtCurve = new THREE.CatmullRomCurve3(keys.map((k) => new THREE.Vector3(...k[1])), false, 'centripetal');

  // --- state & update ---------------------------------------------------------------
  let portrait = false; let target = 0; let current = 0; let mouseX = 0; let mouseY = 0; let running = true; let needResize = true;
  const clock = new THREE.Clock();
  const tmpA = new THREE.Vector3(); const tmpB = new THREE.Vector3();
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function applyParts(t) {
    for (const { obj, a, b, mode } of parts) {
      const k = range(t, a, b);
      obj.visible = k > 0.001;
      if (!obj.visible) continue;
      const h = obj.userData.home;
      if (mode === 'grow') { obj.scale.set(1, Math.max(k, 0.001), 1); obj.position.copy(h); } else if (mode === 'drop') { obj.position.set(h.x, h.y + (1 - k) * 6, h.z); } else { obj.position.set(h.x, h.y - (1 - k) * 1.2, h.z); }
      const op = Math.min(1, k * 1.4);
      obj.traverse((o) => {
        if (!o.isMesh || o.material === glassMat) return;
        const transparent = op < 0.999;
        if (o.material.transparent !== transparent) { o.material.transparent = transparent; o.material.needsUpdate = true; }
        o.material.opacity = op;
      });
    }
    glassMat.opacity = 0.55 * range(t, 4.0, 4.3);
  }

  function update(t, time) {
    // site
    const padK = range(t, 0.55, 1.05);
    if (Math.abs(padK - lastPad) > 0.002) { levelPad(padK); lastPad = padK; }
    const stakeK = range(t, 0.6, 0.9) * (1 - range(t, 2.6, 3.0));
    stakes.visible = stakeK > 0.01; stakeMat.opacity = stakeK; tape.material.opacity = stakeK;

    // sketch: strokes are drawn progressively, then fade when the plan arrives
    const sketchDraw = range(t, 1.0, 1.85);
    const sketchFade = 1 - range(t, 2.2, 2.7) + range(t, 5.95, 6) * 0;
    sketchGroup.visible = sketchDraw > 0 && sketchFade > 0;
    sketchLines.forEach((l, i) => { l.geometry.setDrawRange(0, Math.floor(l.userData.count * sketchDraw / 2) * 2); l.material.opacity = (i === 0 ? 0.9 : 0.35) * sketchFade; });

    // plan
    const planDraw = range(t, 2.05, 2.8); const planFade = 1 - range(t, 3.3, 3.9);
    planGroup.visible = planDraw > 0 && planFade > 0;
    planGeo.setDrawRange(0, Math.floor((planV.length / 3) * planDraw / 2) * 2);
    planLines.material.opacity = planFade;
    grid.material.opacity = 0.18 * range(t, 2.0, 2.4) * planFade;
    paper.material.opacity = 0.55 * range(t, 2.0, 2.4) * planFade;

    applyParts(t);

    // light: from day to blue hour
    const dusk = range(t, 5.1, 5.9);
    scene.background.copy(C.skyDay).lerp(C.skyDusk, dusk);
    scene.fog.color.copy(C.skyDay).lerp(C.fogDusk, dusk);
    sun.intensity = lerp(2.4, 0.25, dusk); sun.color.set(0xfff1dc).lerp(new THREE.Color(0x8fa0ff), dusk);
    hemi.intensity = lerp(1.15, 0.35, dusk);
    renderer.toneMappingExposure = lerp(1.05, 1.25, dusk);
    const glowK = range(t, 5.25, 5.85);
    glassMat.emissiveIntensity = glowK * 2.2;
    glowMat.opacity = glowK * 0.9;
    interior.intensity = glowK * 60; interior2.intensity = glowK * 45;

    // snow
    const snowK = range(t, 5.3, 5.8);
    snow.visible = snowK > 0; snow.material.opacity = snowK * 0.9;
    if (snow.visible && !reduce) {
      const arr = snowGeo.attributes.position.array;
      for (let i = 0; i < SN; i++) { arr[i * 3 + 1] -= 0.035 + (i % 7) * 0.004; arr[i * 3] += Math.sin(time * 0.6 + i) * 0.005; if (arr[i * 3 + 1] < 0) arr[i * 3 + 1] = 40; }
      snowGeo.attributes.position.needsUpdate = true;
    }

    // camera
    const u = clamp(t / 6);
    camCurve.getPoint(u, tmpA); tgtCurve.getPoint(u, tmpB);
    if (portrait) { const k = range(t, 5, 6); tmpB.x += 7 * k; tmpB.z -= 4 * k; tmpB.y -= 1.5 * k; } // phones: keep the house centred above the text
    const orbit = range(t, 5.6, 6) * (reduce ? 0 : Math.sin(time * 0.15) * 0.08);
    const ang = Math.atan2(tmpA.z, tmpA.x) + orbit + mouseX * 0.04;
    const rad = Math.hypot(tmpA.x, tmpA.z);
    camera.position.set(Math.cos(ang) * rad, tmpA.y + mouseY * 1.5, Math.sin(ang) * rad);
    camera.lookAt(tmpB);
  }

  function resize() {
    const w = canvas.clientWidth; const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    portrait = w < h;
    camera.fov = portrait ? 55 : 38; // portrait screens need a wider lens
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(() => { needResize = true; }).observe(canvas);

  function frame() {
    if (!running) return;
    requestAnimationFrame(frame);
    if (needResize) { resize(); needResize = false; }
    const dt = Math.min(clock.getDelta(), 0.25); // slow devices still catch up with the scroll
    current += (target - current) * (reduce ? 1 : 1 - Math.exp(-dt * 4.5));
    update(current, clock.elapsedTime);
    renderer.render(scene, camera);
  }
  frame();
  onReady?.();

  return {
    setProgress(t) { target = clamp(t, 0, 6); },
    setPointer(x, y) { mouseX = x; mouseY = y; },
    pause() { running = false; },
    resume() { if (!running) { running = true; clock.getDelta(); frame(); } },
  };
}
