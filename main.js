// miname — a night winter scene with one character standing in the snow (assets/character.glb),
// framed in the free half of the screen; the other half is a colour panel with the content.
// Scroll, swipe, keys or the nav move between five scenes: the camera flies, the panel repaints.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const CHARACTER_URL = new URLSearchParams(location.search).get('model') || 'assets/character.glb'; // ?model=path tries another GLB
const CHARACTER_HEIGHT = 1.6;

// ---------------------------------------------------------------- helpers
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const lerpAngle = (a, b, t) => a + wrap(b - a) * t;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const lin = (r, g, b) => new THREE.Color().setRGB(r, g, b);
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const params = new URLSearchParams(location.search);
const DEBUG_P = params.has('p') ? +params.get('p') : null;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = id => document.getElementById(id);

// ---------------------------------------------------------------- renderer
const canvas = $('gl');
const PR = Math.min(devicePixelRatio, 1.75);
const renderer = new THREE.WebGLRenderer({ canvas, powerPreference: 'high-performance', preserveDrawingBuffer: DEBUG_P !== null });
renderer.setPixelRatio(PR);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(lin(0.3, 0.27, 0.46), 0.03);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;
const camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, 0.05, 900);

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
const radialTex = (inner, outer) => canvasTex(128, 128, g => {
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, inner); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
});

// ---------------------------------------------------------------- sky, aurora, mountains
const MOON = V(-0.38, 0.42, -0.82).normalize();
const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uMoon: { value: MOON } },
  vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
  fragmentShader: /* glsl */`
    varying vec3 vDir; uniform float uTime; uniform vec3 uMoon;
    float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
    void main(){
      vec3 d = normalize(vDir); float h = d.y;
      vec3 col = mix(vec3(0.55,0.4,0.62), vec3(0.12,0.11,0.3), smoothstep(-0.03, 0.28, h));
      col = mix(col, vec3(0.015,0.02,0.07), smoothstep(0.28, 0.9, h));
      vec3 sd = d * 260.0; vec3 cell = floor(sd); vec3 f = fract(sd) - 0.5; float r = hash(cell);
      col += step(0.982, r) * smoothstep(0.16, 0.0, length(f)) * (0.55 + 0.45 * sin(uTime * (1.5 + r * 3.0) + r * 90.0)) * smoothstep(0.06, 0.4, h) * vec3(2.2, 2.1, 2.3);
      float md = dot(d, uMoon);
      col += vec3(1.0, 0.96, 0.92) * smoothstep(0.99935, 0.99955, md) * 3.2;
      col += vec3(0.75, 0.7, 1.0) * pow(max(md, 0.0), 900.0) * 0.9 + vec3(0.55, 0.48, 0.85) * pow(max(md, 0.0), 30.0) * 0.22;
      gl_FragColor = vec4(col, 1.0);
    }`,
  side: THREE.BackSide, depthWrite: false, fog: false,
}));
sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);

function aurora(radius, height, y, start, len, shift, speed) {
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uShift: { value: shift }, uSpeed: { value: speed } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */`
      varying vec2 vUv; uniform float uTime, uShift, uSpeed;
      void main(){
        float x = vUv.x * 7.0 + uShift * 3.0, t = uTime * uSpeed;
        float band = vUv.y - (0.18 + sin(x * 1.3 + t * 0.6) * 0.12 + sin(x * 3.7 - t * 0.9) * 0.05);
        float curtain = smoothstep(0.0, 0.04, band) * exp(-band * 3.2);
        float rays = (0.55 + 0.45 * sin(x * 36.0 + sin(x * 5.0 + t) * 4.0)) * (0.7 + 0.3 * sin(x * 9.0 - t * 1.7));
        vec3 col = mix(mix(vec3(0.3, 1.0, 0.72), vec3(1.0, 0.42, 0.82), uShift), vec3(0.55, 0.42, 1.0), smoothstep(0.05, 0.55, band));
        float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
        gl_FragColor = vec4(col * curtain * rays * edge * 0.95, 1.0);
      }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 160, 1, true, start, len), m);
  mesh.position.y = y; mesh.frustumCulled = false; scene.add(mesh);
  return m;
}
const auroras = [aurora(170, 110, 85, Math.PI - 1.2, 2.0, 0.0, 0.5), aurora(150, 90, 95, Math.PI - 0.3, 1.6, 0.85, 0.35)];

function ridge(radius, base, amp, seed, low, high) {
  const g = new THREE.CylinderGeometry(radius, radius, 1, 360, 1, true);
  const p = g.attributes.position, rnd = mulberry32(seed), ph = [rnd() * 6, rnd() * 6, rnd() * 6], colors = [];
  for (let i = 0; i < p.count; i++) {
    const a = Math.atan2(p.getX(i), p.getZ(i)), top = p.getY(i) > 0;
    p.setY(i, top ? base + amp * (0.55 * Math.abs(Math.sin(a * 3 + ph[0])) + 0.3 * Math.abs(Math.sin(a * 7.3 + ph[1])) + 0.15 * Math.sin(a * 19 + ph[2])) : -20);
    const c = top ? high : low; colors.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }));
  m.frustumCulled = false; scene.add(m);
}
ridge(300, 14, 40, 11, lin(0.17, 0.14, 0.3), lin(0.38, 0.33, 0.54));
ridge(230, 6, 22, 5, lin(0.1, 0.09, 0.21), lin(0.24, 0.22, 0.4));

// ---------------------------------------------------------------- ground
function H(x, z) {
  const r = Math.hypot(x, z), m = ss(3.5, 13, r);
  return m * (Math.sin(x * 0.16 + 1.3) * Math.cos(z * 0.13 - 0.4) * 0.9 + Math.sin(x * 0.41 + z * 0.27) * 0.3 + Math.sin(x * 1.1 - z * 0.8) * 0.05) + m * m * r * 0.02;
}
{
  const g = new THREE.PlaneGeometry(200, 200, 260, 260); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, H(p.getX(i), p.getZ(i)));
  g.computeVertexNormals();
  const tex = canvasTex(512, 512, (c, w, h) => {
    c.fillStyle = '#fff'; c.fillRect(0, 0, w, h);
    const rnd = mulberry32(5); c.filter = 'blur(6px)';
    for (let i = 0; i < 260; i++) {
      c.fillStyle = rnd() > 0.5 ? `rgba(180,180,235,${0.05 + rnd() * 0.08})` : `rgba(255,255,255,${0.2 + rnd() * 0.3})`;
      c.beginPath(); c.ellipse(rnd() * w, rnd() * h, 10 + rnd() * 40, 6 + rnd() * 20, rnd() * 3, 0, Math.PI * 2); c.fill();
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(44, 44);
  const ground = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#b3b7dc', roughness: 0.95, map: tex }));
  ground.receiveShadow = true; scene.add(ground);
}

// glints that flash as the camera moves
const glint = (() => {
  const N = 6000, rnd = mulberry32(21), pos = new Float32Array(N * 3), ph = new Float32Array(N);
  for (let i = 0; i < N; i++) { const a = rnd() * Math.PI * 2, r = 0.8 + Math.sqrt(rnd()) * 24, x = Math.sin(a) * r, z = Math.cos(a) * r; pos.set([x, H(x, z) + 0.012, z], i * 3); ph[i] = rnd(); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uCam: { value: V() }, uPR: { value: PR } },
    vertexShader: /* glsl */`
      attribute float aPhase; uniform float uTime, uPR; uniform vec3 uCam; varying float vA;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
        float tw = pow(max(0.0, sin(aPhase * 60.0 + dot(normalize(uCam - position), vec3(41.0, 27.0, 33.0)) + uTime * 0.7)), 30.0);
        vA = tw * smoothstep(28.0, 3.0, -mv.z);
        gl_PointSize = (2.0 + 4.0 * tw) * uPR * clamp(5.0 / -mv.z, 0.7, 2.2);
      }`,
    fragmentShader: `varying float vA; void main(){ vec2 c = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(c)) + smoothstep(0.08, 0.0, abs(c.x)) * smoothstep(0.5, 0.0, abs(c.y)) + smoothstep(0.08, 0.0, abs(c.y)) * smoothstep(0.5, 0.0, abs(c.x)); gl_FragColor = vec4(vec3(2.2, 2.3, 2.8) * a * vA, 1.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; scene.add(pts);
  return m;
})();

// ---------------------------------------------------------------- pines and mounds
{
  const rnd = mulberry32(7);
  const pine = new THREE.MeshStandardMaterial({ color: '#21404a', roughness: 0.9 });
  const snowM = new THREE.MeshStandardMaterial({ color: '#d4d7f2', roughness: 0.85 });
  const bark = new THREE.MeshStandardMaterial({ color: '#4b3940', roughness: 1 });
  const trees = [[-4.8, -6.2, 1.3], [-6.2, -2.0, 1.05], [-1.8, -8.4, 1.5], [3.8, -7.0, 1.2], [6.4, -3.2, 1.35], [-6.8, 3.0, 1.15], [7.0, 2.2, 1.0], [-4.6, -9.6, 1.65], [1.2, -10.6, 1.55], [5.0, -10.0, 1.3], [-9.4, -5.4, 1.55], [-3.0, 8.4, 1.25], [4.2, 8.6, 1.05]];
  for (let k = 0; k < 160; k++) { const a = rnd() * Math.PI * 2, r = 11 + Math.pow(rnd(), 0.7) * 60; trees.push([Math.sin(a) * r, Math.cos(a) * r, 0.8 + rnd() * 1.1]); }
  const TIERS = 4, cone = new THREE.ConeGeometry(1, 1, 12, 1); cone.translate(0, 0.5, 0);
  const trunkGeo = new THREE.CylinderGeometry(1, 1, 1, 8); trunkGeo.translate(0, 0.5, 0);
  const pines = new THREE.InstancedMesh(cone, pine, trees.length * TIERS), caps = new THREE.InstancedMesh(cone, snowM, trees.length * TIERS), trunks = new THREE.InstancedMesh(trunkGeo, bark, trees.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = V(), p = V();
  trees.forEach(([x, z, sc], i) => {
    const y0 = H(x, z) - 0.1; q.setFromAxisAngle(V(0, 1, 0), rnd() * Math.PI);
    trunks.setMatrixAt(i, m4.compose(p.set(x, y0, z), q, s.set(0.1 * sc, 0.7 * sc, 0.1 * sc)));
    for (let k = 0; k < TIERS; k++) {
      const r = (0.98 - 0.2 * k) * sc, h = (1.15 - 0.13 * k) * sc, y = y0 + (0.5 + k * 0.62) * sc;
      pines.setMatrixAt(i * TIERS + k, m4.compose(p.set(x, y, z), q, s.set(r, h, r)));
      caps.setMatrixAt(i * TIERS + k, m4.compose(p.set(x, y + h * 0.14 + 0.02 * sc, z), q, s.set(r * 0.95, h * 0.86, r * 0.95)));
    }
  });
  for (const im of [pines, caps, trunks]) { im.castShadow = true; im.receiveShadow = true; scene.add(im); }
  const N = 40, mound = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mounds = new THREE.InstancedMesh(mound, snowM, N);
  for (let i = 0; i < N; i++) {
    const a = rnd() * Math.PI * 2, r = 5.5 + rnd() * 16, x = Math.sin(a) * r, z = Math.cos(a) * r, sc = 0.25 + rnd() * 0.6;
    mounds.setMatrixAt(i, m4.compose(p.set(x, H(x, z) - 0.12 * sc, z), q.setFromAxisAngle(V(0, 1, 0), rnd() * 3), s.set(sc * (1 + rnd() * 0.6), sc * (0.5 + rnd() * 0.3), sc)));
  }
  mounds.receiveShadow = true; scene.add(mounds);
}

// stone lantern with a warm light
const LANTERN = V(-1.3, 0, -0.6);
const lanternLight = new THREE.PointLight('#ffad66', 3, 7, 1.6);
{
  const stone = new THREE.MeshStandardMaterial({ color: '#8b879e', roughness: 0.9 }), snowM = new THREE.MeshStandardMaterial({ color: '#f2f3ff', roughness: 0.85 });
  const lg = new THREE.Group(); lg.position.copy(LANTERN); lg.rotation.y = 0.5; lg.scale.setScalar(1.3); scene.add(lg);
  const add = (geo, mat, pos, rot) => { const m = new THREE.Mesh(geo, mat); m.position.set(...pos); if (rot) m.rotation.set(...rot); m.castShadow = true; lg.add(m); };
  add(new THREE.CylinderGeometry(0.15, 0.18, 0.08, 8), stone, [0, 0.04, 0]);
  add(new THREE.CylinderGeometry(0.055, 0.065, 0.42, 8), stone, [0, 0.29, 0]);
  add(new THREE.BoxGeometry(0.28, 0.06, 0.28), stone, [0, 0.53, 0]);
  add(new THREE.BoxGeometry(0.29, 0.03, 0.29), snowM, [0, 0.57, 0]);
  const glow = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.15, 0.16), new THREE.MeshBasicMaterial({ color: lin(3.2, 1.6, 0.6) })); glow.position.set(0, 0.645, 0); lg.add(glow);
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) add(new THREE.BoxGeometry(0.03, 0.17, 0.03), stone, [x * 0.09, 0.645, z * 0.09]);
  add(new THREE.ConeGeometry(0.27, 0.15, 4), stone, [0, 0.79, 0], [0, Math.PI / 4, 0]);
  add(new THREE.ConeGeometry(0.235, 0.11, 4), snowM, [0, 0.83, 0], [0, Math.PI / 4, 0]);
  lanternLight.position.set(LANTERN.x, 0.84, LANTERN.z); scene.add(lanternLight);
}

// footprints leading to the character
{
  const g = new THREE.CircleGeometry(1, 20); g.rotateX(-Math.PI / 2);
  const m = new THREE.MeshBasicMaterial({ color: '#6c70b4', transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const curve = new THREE.QuadraticBezierCurve3(V(7, 0, -3.5), V(2.8, 0, 1.4), V(0.3, 0, 0.2));
  const N = 22, inst = new THREE.InstancedMesh(g, m, N), m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1) * 0.92, p = curve.getPoint(t), d = curve.getTangent(t), side = i % 2 ? 1 : -1;
    const x = p.x - d.z * side * 0.1, z = p.z + d.x * side * 0.1;
    q.setFromAxisAngle(V(0, 1, 0), Math.atan2(d.x, d.z));
    inst.setMatrixAt(i, m4.compose(V(x, H(x, z) + 0.004, z), q, V(0.065, 1, 0.13)));
  }
  scene.add(inst);
}

// falling snow, wrapped around the camera; close flakes turn into soft bokeh
const snow = (() => {
  const N = 9000, rnd = mulberry32(99), pos = new Float32Array(N * 3), rd = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { pos.set([rnd() * 26, rnd() * 16, rnd() * 26], i * 3); rd.set([rnd(), rnd(), rnd()], i * 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aRand', new THREE.BufferAttribute(rd, 3));
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uCam: { value: V() }, uPR: { value: PR }, uH: { value: innerHeight } },
    vertexShader: /* glsl */`
      attribute vec3 aRand; uniform float uTime, uPR, uH; uniform vec3 uCam; varying float vA; varying float vSoft;
      void main(){
        vec3 p = position;
        p.y -= uTime * (0.28 + aRand.x * 0.45);
        p.x += sin(uTime * 0.6 + aRand.y * 6.28) * 0.35 + uTime * 0.12;
        p.z += cos(uTime * 0.45 + aRand.y * 4.0) * 0.3;
        vec3 box = vec3(26.0, 16.0, 26.0);
        p = mod(p - uCam + box * 0.5, box) - box * 0.5 + uCam;
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
        float size = (0.018 + aRand.z * 0.03) * uFIG * uPR * 0.9 / -mv.z;
        gl_PointSize = clamp(size, 1.0, 70.0 * uPR);
        vSoft = smoothstep(4.0, 30.0, size / uPR);
        vA = smoothstep(0.15, 0.7, -mv.z) * (0.55 + 0.45 * aRand.z) * (1.0 - vSoft * 0.65);
      }`,
    fragmentShader: `varying float vA; varying float vSoft; void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vec3(1.25, 1.22, 1.35), smoothstep(0.5, mix(0.15, 0.0, vSoft), d) * vA); }`,
    transparent: true, depthWrite: false,
  });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; scene.add(pts);
  return m;
})();

// soft contact shadow under the feet
const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), new THREE.MeshBasicMaterial({ map: radialTex('rgba(60,50,120,.55)', 'rgba(60,50,120,0)'), transparent: true, depthWrite: false }));
blob.rotation.x = -Math.PI / 2; blob.position.y = 0.005; scene.add(blob);

// ---------------------------------------------------------------- lights
scene.add(new THREE.HemisphereLight('#7078d8', '#b9b0dc', 0.55));
const key = new THREE.DirectionalLight('#f1ecff', 1.25);
key.position.set(3.2, 6, 4.4); key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 25 });
key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
scene.add(key, key.target);
const moonLight = new THREE.DirectionalLight('#aeb8ff', 1.1); moonLight.position.copy(MOON).multiplyScalar(10); scene.add(moonLight);
const rim = new THREE.DirectionalLight('#ff9fd0', 1.2); rim.position.set(3, 2.5, -5); scene.add(rim);

// ---------------------------------------------------------------- the character
// she stands still in the snow; any GLB is scaled to CHARACTER_HEIGHT and centred on the spot
const hero = new THREE.Group(); hero.rotation.y = 0.12; scene.add(hero);
const ready = { model: false };
new GLTFLoader().load(CHARACTER_URL, gltf => {
  const model = gltf.scene;
  model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material) o.material.envMapIntensity = 0.6; } });
  const box = new THREE.Box3().setFromObject(model), size = box.getSize(V());
  model.scale.setScalar(CHARACTER_HEIGHT / size.y);
  box.setFromObject(model);
  // centre on the head and shoulders, not the bounding box, so a tail or a prop does not push her off the mark
  model.updateMatrixWorld(true);
  const c = box.getCenter(V()), top = box.min.y + (box.max.y - box.min.y) * 0.8, v = V();
  let sx = 0, sz = 0, n = 0;
  model.traverse(o => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position, stepN = Math.max(1, Math.floor(pos.count / 20000));
    for (let k = 0; k < pos.count; k += stepN) { v.fromBufferAttribute(pos, k).applyMatrix4(o.matrixWorld); if (v.y > top) { sx += v.x; sz += v.z; n++; } }
  });
  if (n) { c.x = sx / n; c.z = sz / n; }
  model.position.set(-c.x, -box.min.y, -c.z);
  hero.add(model);
  ready.model = true;
}, undefined, err => { console.error('character failed to load', err); ready.model = true; });

// ---------------------------------------------------------------- post
const rt = new THREE.WebGLRenderTarget(innerWidth * PR, innerHeight * PR, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.setPixelRatio(PR);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.55, 0.55, 1.35);
composer.addPass(bloom);
// finishing pass: vignette, grain, and during a scene change a zoom blur toward the character
const finish = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2() }, uTrans: { value: 0 }, uFocus: { value: new THREE.Vector2(0.5, 0.5) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uTrans; uniform vec2 uRes, uFocus; varying vec2 vUv;
    vec3 tap(vec2 uv, vec2 c, float ca){ return vec3(texture2D(tDiffuse, uv + c * ca).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - c * ca).b); }
    void main(){
      vec2 c = vUv - 0.5;
      float ca = 0.016 * dot(c, c) + uTrans * 0.012;
      vec2 dir = vUv - uFocus;
      vec3 col = vec3(0.0);
      for (int k = 0; k < 10; k++) { float t = float(k) / 9.0; col += tap(vUv - dir * uTrans * 0.11 * t, c, ca); }
      col /= 10.0;
      col += uTrans * vec3(0.05, 0.035, 0.08);
      col *= mix(0.62, 1.0, smoothstep(0.9, 0.25, length(c * vec2(1.0, 0.85))));
      col += (fract(sin(dot(vUv * uRes + fract(uTime) * 91.0, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.03;
      gl_FragColor = vec4(col, 1.0);
    }`,
});
composer.addPass(finish);
composer.addPass(new OutputPass());

// ---------------------------------------------------------------- scenes
// one per panel page; framed for a figure CHARACTER_HEIGHT tall standing at the origin
const FIG = CHARACTER_HEIGHT;
let time = 0;
const SCENES = [
  { c: '#F4A6BD', cam: () => ({ pos: V(2.2, FIG * 2.3, 2.8), tgt: V(0, FIG * 0.48, 0), fov: 30 }) },          // hello: high, from the corner
  { c: '#A9C8F5', cam: () => ({ pos: V(-1.9, FIG * 0.82, 2.6), tgt: V(0, FIG * 0.56, 0), fov: 30 }) },        // works: three-quarter, full figure
  { c: '#CDB6F4', cam: () => ({ pos: V(0.7, FIG * 0.62, 3.6), tgt: V(0, FIG * 0.8, 0), fov: 42 }) },         // prices: full figure under the aurora
  { c: '#F7C1A8', cam: () => ({ pos: V(2.1, FIG * 0.72, -2.4), tgt: V(0, FIG * 0.74, 0.2), fov: 36 }) },     // contact: from behind, back right corner, at waist height
];
const LAST = SCENES.length - 1;
const INTRO = { pos: V(8, 20, 13), tgt: V(0, FIG * 0.6, 0), fov: 46 };
function toSph(off) { const r = off.length(); return { r, th: Math.atan2(off.x, off.z), ph: Math.acos(clamp(off.y / r, -1, 1)) }; }
function blendCam(A, B, t) {
  const sa = toSph(A.pos.clone().sub(A.tgt)), sb = toSph(B.pos.clone().sub(B.tgt));
  return { tgt: A.tgt.clone().lerp(B.tgt, t), r: lerp(sa.r, sb.r, t), th: lerpAngle(sa.th, sb.th, t), ph: lerp(sa.ph, sb.ph, t), fov: lerp(A.fov, B.fov, t) };
}
const fromSph = c => ({ pos: c.tgt.clone().add(V().setFromSphericalCoords(c.r, c.ph, c.th)), tgt: c.tgt, fov: c.fov });

// ---------------------------------------------------------------- panel
const root = document.documentElement;
const ui = $('ui'), wipe = $('wipe');
const sceneEls = [...document.querySelectorAll('.scene')];
const navBtns = [...document.querySelectorAll('.ui__nav button')];
const state = { p: DEBUG_P === null ? 0 : clamp(Math.round(DEBUG_P), 0, LAST), trans: 0 };
let current = state.p, busy = false, started = false;
if (window.gsap && window.DrawSVGPlugin) gsap.registerPlugin(DrawSVGPlugin);

function enter(el, dir, delay = 0) {
  const lines = el.querySelectorAll('.ln > span'), blocks = el.querySelectorAll('[data-a]');
  el.classList.add('is-active');
  if (!window.gsap || reduced) return;
  gsap.killTweensOf([lines, blocks]);
  gsap.fromTo(lines, { yPercent: 115 * dir, rotate: 5 * dir }, { yPercent: 0, rotate: 0, duration: 1.15, stagger: 0.08, ease: 'expo.out', delay, transformOrigin: '0% 100%' });
  gsap.fromTo(blocks, { y: 34 * dir, opacity: 0 }, { y: 0, opacity: 1, duration: 0.95, stagger: 0.05, ease: 'expo.out', delay: delay + 0.14 });
}
function leave(el, dir) {
  const lines = el.querySelectorAll('.ln > span'), blocks = el.querySelectorAll('[data-a]');
  if (!window.gsap || reduced) { el.classList.remove('is-active'); return; }
  gsap.killTweensOf([lines, blocks]);
  gsap.to(lines, { yPercent: -115 * dir, rotate: -3 * dir, duration: 0.55, stagger: 0.04, ease: 'power3.in' });
  gsap.to(blocks, { y: -26 * dir, opacity: 0, duration: 0.45, stagger: 0.025, ease: 'power2.in' });
  setTimeout(() => { if (el !== sceneEls[current]) el.classList.remove('is-active'); }, 750);
}
// the next colour sweeps over the panel in the direction of travel; the counters roll
function paint(i, dir, instant = false) {
  const c = SCENES[i].c;
  navBtns.forEach((b, k) => b.classList.toggle('on', k === i));
  if (!window.gsap || instant || reduced) {
    root.style.setProperty('--c', c);
    if (window.gsap) gsap.set(['#odo', '#big'], { yPercent: -100 * i / SCENES.length });
    return;
  }
  gsap.killTweensOf(wipe); clearTimeout(paint.t);
  wipe.style.background = c;
  gsap.fromTo(wipe, { clipPath: dir > 0 ? 'inset(100% 0% 0% 0%)' : 'inset(0% 0% 100% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.05, ease: 'expo.inOut' });
  // commit the colour on a plain timer so the panel never stays half-painted
  paint.t = setTimeout(() => { root.style.setProperty('--c', c); gsap.killTweensOf(wipe); gsap.set(wipe, { clipPath: 'inset(100% 0% 0% 0%)' }); }, 1100);
  gsap.to('#odo', { yPercent: -100 * i / SCENES.length, duration: 1, ease: 'expo.inOut' });
  gsap.to('#big', { yPercent: -100 * i / SCENES.length, duration: 1.4, ease: 'expo.inOut' });
}
function goTo(i) {
  i = clamp(i, 0, LAST);
  if (i === current || busy || !started) return;
  const dir = i > current ? 1 : -1, prev = current;
  current = i; busy = true;
  leave(sceneEls[prev], dir);
  enter(sceneEls[i], dir, 0.42);
  paint(i, dir);
  if (!window.gsap || reduced) { state.p = i; busy = false; return; }
  const dur = 1.5 + 0.22 * (Math.abs(i - prev) - 1);
  gsap.to(state, { p: i, duration: dur, ease: 'power3.inOut', overwrite: 'auto' });
  gsap.timeline().to(state, { trans: 1, duration: dur * 0.4, ease: 'power2.in' }).to(state, { trans: 0, duration: dur * 0.6, ease: 'power2.out' });
  setTimeout(() => { busy = false; }, 950);
}

// ---------------------------------------------------------------- input
document.querySelectorAll('[data-go]').forEach(el => el.addEventListener('click', e => { e.preventDefault(); goTo(+el.dataset.go); }));
document.querySelectorAll('a[aria-disabled="true"]').forEach(a => a.addEventListener('click', e => e.preventDefault()));
// one wheel gesture = one scene: inertia after a move is ignored until the wheel goes quiet
let lastWheel = 0, guard = false;
addEventListener('wheel', e => {
  e.preventDefault();
  if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
  const now = performance.now(), gap = now - lastWheel; lastWheel = now;
  if (gap > 220) guard = false;
  if (busy || guard || Math.abs(e.deltaY) < 4) return;
  guard = true;
  goTo(current + Math.sign(e.deltaY));
}, { passive: false });
let touch = null;
addEventListener('touchstart', e => { touch = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }, { passive: true });
addEventListener('touchend', e => {
  if (!touch) return;
  const t = e.changedTouches[0], dx = touch.x - t.clientX, dy = touch.y - t.clientY; touch = null;
  if (Math.abs(dy) > 50 && Math.abs(dy) > Math.abs(dx) * 1.2) goTo(current + Math.sign(dy));
});
addEventListener('keydown', e => {
  const k = { ArrowDown: 1, PageDown: 1, ' ': 1, ArrowUp: -1, PageUp: -1 }[e.key];
  if (k) { e.preventDefault(); goTo(current + k); }
  if (e.key === 'Home') { e.preventDefault(); goTo(0); }
  if (e.key === 'End') { e.preventDefault(); goTo(LAST); }
});
const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
addEventListener('pointermove', e => { mouse.x = e.clientX / innerWidth * 2 - 1; mouse.y = e.clientY / innerHeight * 2 - 1; });

const isTall = () => camera.aspect < 0.8; // matches the CSS media query that moves the panel to the bottom
// frame the character in the free half: right of the panel on wide screens, above it on tall ones
function frameOffset(w, h) {
  if (isTall()) camera.setViewOffset(w, h, 0, h * 0.26, w, h);
  else camera.setViewOffset(w, h, -w * 0.24, 0, w, h);
}
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h); composer.setSize(w, h); bloom.resolution.set(w / 2, h / 2);
  camera.aspect = w / h; frameOffset(w, h);
  renderer.getDrawingBufferSize(finish.uniforms.uRes.value);
  snow.uniforms.uH.value = h;
}
addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- frame
const intro = { t: reduced || DEBUG_P !== null ? 1 : 0 };
let last = performance.now();
const tmp = V(), focus = V();

function step(dt) {
  time += dt;
  const p = state.p, i = clamp(Math.floor(p), 0, LAST - 1);
  let cam = blendCam(SCENES[i].cam(), SCENES[i + 1].cam(), p - i);
  if (intro.t < 1) cam = blendCam(INTRO, fromSph(cam), intro.t);
  mouse.sx += (mouse.x - mouse.sx) * (1 - Math.exp(-dt * 3)); mouse.sy += (mouse.y - mouse.sy) * (1 - Math.exp(-dt * 3));
  // tall screens see a narrow slice, so the camera backs off (more for the close portrait)
  const far = isTall() ? lerp(SCENES[i].tall || 1.85, SCENES[i + 1].tall || 1.85, p - i) : 1;
  const th = cam.th - mouse.sx * 0.05 + Math.sin(time * 0.37) * 0.006;
  const ph = clamp(cam.ph - mouse.sy * 0.035 + Math.sin(time * 0.53) * 0.004, 0.05, 2.0);
  camera.position.copy(cam.tgt).add(tmp.setFromSphericalCoords(cam.r * far, ph, th));
  camera.fov = cam.fov; camera.updateProjectionMatrix(); camera.lookAt(cam.tgt);

  // the transition blur streams toward the character's chest on screen
  focus.set(0, FIG * 0.6, 0).project(camera);
  finish.uniforms.uFocus.value.set(focus.x * 0.5 + 0.5, focus.y * 0.5 + 0.5);
  finish.uniforms.uTrans.value = state.trans;

  lanternLight.intensity = 3 + Math.sin(time * 13) * 0.15 + Math.sin(time * 7.3) * 0.2;
  snow.uniforms.uTime.value = time; snow.uniforms.uCam.value.copy(camera.position);
  glint.uniforms.uTime.value = time; glint.uniforms.uCam.value.copy(camera.position);
  sky.material.uniforms.uTime.value = time; sky.position.copy(camera.position);
  for (const a of auroras) a.uniforms.uTime.value = time;
  finish.uniforms.uTime.value = time;
}
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  step(dt); composer.render();
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- intro
requestAnimationFrame(frame);
(function runIntro() {
  const loader = $('loader'), count = $('count');
  const done = () => { loader.remove(); document.body.classList.remove('is-loading'); };
  paint(current, 1, true);
  if (!window.gsap || intro.t >= 1) { done(); enter(sceneEls[current], 1); started = true; return; }
  const lines = loader.querySelectorAll('.wm__lines path'), star = loader.querySelector('.wm__star');
  const c = { v: 0 };
  const tall = isTall();
  gsap.set(ui, tall ? { yPercent: 105 } : { xPercent: -105 });
  const tl = gsap.timeline();
  tl.to(c, { v: 100, duration: 1.8, ease: 'power2.inOut', onUpdate: () => { count.textContent = String(Math.round(c.v)).padStart(3, '0'); } }, 0);
  if (window.DrawSVGPlugin) tl.from(lines, { drawSVG: '0%', duration: 1.4, stagger: 0.12, ease: 'power2.inOut' }, 0.1);
  tl.from(star, { scale: 0, rotation: -180, duration: 0.7, ease: 'back.out(2.2)' }, 1.15);
  // hold the curtain until the character has loaded
  tl.add(() => { if (!ready.model) { tl.pause(); const t = setInterval(() => { if (ready.model) { clearInterval(t); tl.resume(); } }, 100); } }, 1.9);
  tl.to(loader, { clipPath: 'inset(0% 0% 100% 0%)', duration: 1.2, ease: 'expo.inOut' }, 2.1);
  tl.to(intro, { t: 1, duration: 3.4, ease: 'power3.inOut' }, 1.95);
  tl.add(done, 3.3);
  tl.to(ui, tall ? { yPercent: 0, duration: 1.4, ease: 'expo.out' } : { xPercent: 0, duration: 1.4, ease: 'expo.out' }, 3.4);
  tl.add(() => { enter(sceneEls[current], 1); started = true; }, 3.75);
})();

// dev only (?p=N): render a scene and post the 3D frame to a local receiver
if (DEBUG_P !== null) window.__m = {
  ready,
  async shot(p, name, w = 1280, h = 800, settle = 2) {
    state.p = p; state.trans = 0;
    renderer.setSize(w, h, false); composer.setSize(w, h); camera.aspect = w / h; frameOffset(w, h);
    for (let t = 0; t < settle; t += 1 / 30) step(1 / 30);
    composer.render();
    await fetch('http://127.0.0.1:8811/?name=' + name, { method: 'POST', body: renderer.domElement.toDataURL('image/png') });
    return name;
  },
};
