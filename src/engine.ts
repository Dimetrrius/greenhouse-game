/* "Grow the harvest": a Three.js greenhouse game.
   The player keeps ten tomato plants alive by hand or hands control to the autopilot.
   At the end the same conditions are replayed headlessly to compare money and resources.
   Three.js is imported dynamically so the page shell paints before the 3D code arrives. */
import type * as ThreeNS from 'three';

type T = (ru: string, en: string) => string;
type Three = typeof ThreeNS;
type Toggle = 'pump' | 'lamps' | 'vent';
type Variety = {key: string; name: string; growth: number; thirst: number; heatMax: number; yieldKg: number; price: number; fruit: {n: number; r: number; sy: number; hue: number}};
type State = {hour: number; day: number; moisture: number; temp: number; light: number; health: number; water: number; energy: number; actions: number; healthSum: number; hours: number; qSum: number;
  pump: boolean; lamps: boolean; vent: boolean; auto: boolean; usedAuto: boolean; running: boolean; over: boolean; flags: Record<string, boolean>; stress: string; stressNow: boolean; growth: number[]};
type Result = {kg: number; quality: number; revenue: number; energyCost: number; waterCost: number; cost: number; profit: number; days: number; energy: number; water: number; harvested: boolean};
export type GreenhouseGame = {frame(dt: number): void; destroy(): void; simulate(hours: number): {avg: number; over: boolean}};

const TARIFF = 0.22;     // $ per kWh
const WATER = 0.004;     // $ per litre incl. nutrients
export const BUDGET_KWH = 70;
const PLANTS = 10;
const HOURS_PER_SEC = 0.6;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ramp = (v: number, a: number, b: number) => clamp((v - a) / (b - a), 0, 1);
const settle = (k: number) => 1 - (1 - k) ** 3;
/** Fills {name} placeholders after translation, so dictionaries key on stable templates. */
const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));

export function varieties(t: T): Record<string, Variety> {
  return {
    cherry: {key: 'cherry', name: t('Черри', 'Cherry'), growth: 1.25, thirst: 1.15, heatMax: 33, yieldKg: 2.8, price: 5.0, fruit: {n: 9, r: 0.034, sy: 1, hue: 0.0}},
    plum: {key: 'plum', name: t('Сливка', 'Plum'), growth: 1.0, thirst: 0.85, heatMax: 34, yieldKg: 4.0, price: 3.0, fruit: {n: 6, r: 0.048, sy: 1.35, hue: 0.01}},
    heart: {key: 'heart', name: t('Бычье сердце', 'Oxheart'), growth: 0.8, thirst: 1.0, heatMax: 31, yieldKg: 5.5, price: 3.6, fruit: {n: 3, r: 0.085, sy: 0.82, hue: 0.97}},
  };
}

/* ================= simulation core (shared by live game and headless replays) ================= */
function seeded(seed: number) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }
const sunOf = (h: number) => Math.max(0, Math.sin(((h - 6) / 12) * Math.PI));
const newState = (): State => ({hour: 8, day: 1, moisture: 55, temp: 19, light: 0, health: 100, water: 0, energy: 0, actions: 0, healthSum: 0, hours: 0, qSum: 0,
  pump: false, lamps: false, vent: false, auto: false, usedAuto: false, running: false, over: false, flags: {}, stress: '', stressNow: false, growth: Array(PLANTS).fill(0.04)});
const avgGrowth = (S: State) => S.growth.reduce((s, g) => s + g, 0) / PLANTS;

function createSimulation(t: T, varies: number[]) {
  const physics = (S: State, V: Variety, dtH: number) => {
    S.hour += dtH; if (S.hour >= 24) { S.hour -= 24; S.day++; }
    const sunK = sunOf(S.hour);
    S.light = clamp(sunK + (S.lamps ? 0.75 : 0), 0, 1.3);
    const tTarget = 15 + sunK * 17 + (S.lamps ? 1.5 : 0) - (S.vent ? 8 : 0);
    S.temp += (tTarget - S.temp) * Math.min(1, dtH * 0.9);
    const evap = (1.4 + sunK * 3.4 + Math.max(0, S.temp - 25) * 0.45) * V.thirst;
    S.moisture = clamp(S.moisture - evap * dtH + (S.pump ? 24 * dtH : 0), 0, 100);
    S.water += S.pump ? 40 * dtH : 0;
    S.energy += ((S.lamps ? 2.4 : 0) + (S.vent ? 0.4 : 0) + (S.pump ? 0.75 : 0)) * dtH;
    const fW = S.moisture < 40 ? ramp(S.moisture, 18, 40) : 1 - ramp(S.moisture, 76, 93) * 0.85;
    const fL = clamp(S.light / 0.7, 0, 1);
    const fT = S.temp < 20 ? ramp(S.temp, 11, 20) : 1 - ramp(S.temp, V.heatMax - 5, V.heatMax + 1);
    const vigor = 0.35 + 0.65 * (S.health / 100);
    for (let i = 0; i < PLANTS; i++) S.growth[i] = clamp(S.growth[i] + 0.026 * varies[i] * V.growth * fW * fL * fT * vigor * dtH, 0, 1);
    let stress = '';
    if (S.moisture < 16) stress = t('Почва пересохла', 'The soil dried out');
    else if (S.moisture > 94) stress = t('Перелив: корням не хватает воздуха', 'Overwatering: the roots ran out of air');
    else if (S.temp > V.heatMax + 1) stress = fill(t('Перегрев: сорт «{name}» не выносит жару выше {heatMax}°','Overheating: {name} cannot take heat above {heatMax}°'),{name:V.name,heatMax:V.heatMax});
    else if (S.temp < 10) stress = t('Переохлаждение', 'Too cold');
    S.stressNow = !!stress;
    if (stress) { S.health = clamp(S.health - 11 * dtH, 0, 100); S.stress = stress; } else S.health = clamp(S.health + 2.5 * dtH, 0, 100);
    S.healthSum += S.health * dtH; S.hours += dtH;
    S.qSum += fW * (S.temp < 20 ? 1 : 1 - ramp(S.temp, V.heatMax - 6, V.heatMax)) * dtH; // time spent in the comfort zone
    return sunK;
  };
  const autopilot = (S: State, V: Variety) => {
    const sunK = sunOf(S.hour);
    return {
      pump: S.moisture < 45 ? true : S.moisture > 66 ? false : S.pump,
      lamps: sunK < 0.35 && S.hour >= 5 && S.hour < 21,
      vent: S.temp > Math.min(27, V.heatMax - 5) ? true : S.temp < 23 ? false : S.vent,
    };
  };
  // A realistic hand routine: big watering bursts, lamps all evening and night, late venting.
  const typicalManual = (S: State) => ({
    pump: S.moisture < 25 ? true : S.moisture > 90 ? false : S.pump,
    lamps: S.hour >= 18 || S.hour < 8,
    vent: S.temp > 31 ? true : S.temp < 24 ? false : S.vent,
  });
  const economics = (S: State, V: Variety, harvested: boolean): Result => {
    const healthAvg = S.hours ? S.healthSum / S.hours : S.health;
    const quality = S.hours ? S.qSum / S.hours : 1;
    const kg = harvested ? PLANTS * V.yieldKg * (0.45 + 0.55 * quality) * (0.6 + (0.4 * healthAvg) / 100) : 0;
    const energyCost = S.energy * TARIFF, waterCost = S.water * WATER, revenue = kg * V.price;
    return {kg, quality, revenue, energyCost, waterCost, cost: energyCost + waterCost, profit: revenue - energyCost - waterCost, days: S.day - 1 + (S.hour - 8) / 24, energy: S.energy, water: S.water, harvested};
  };
  const replay = (policy: (S: State, V: Variety) => Partial<State>, V: Variety) => {
    const S = newState();
    for (let i = 0; i < 24 * 12 * 20; i++) { // up to 12 days in 3-minute steps
      Object.assign(S, policy(S, V));
      physics(S, V, 0.05);
      if (S.health <= 0) return economics(S, V, false);
      if (avgGrowth(S) >= 0.999) return economics(S, V, true);
    }
    return economics(S, V, false);
  };
  return {physics, autopilot, typicalManual, economics, replay};
}

/** Loads Three.js and mounts the game into the markup from game-markup.ts. Throws when WebGL is unavailable. */
export async function mountGreenhouseGame(root: HTMLElement, t: T, reduced: () => boolean): Promise<GreenhouseGame> {
  const [THREE, {OrbitControls}, {mergeGeometries}] = await Promise.all([
    import('three'),
    import('three/examples/jsm/controls/OrbitControls.js'),
    import('three/examples/jsm/utils/BufferGeometryUtils.js'),
  ]);
  return start(root, t, reduced, THREE, OrbitControls, mergeGeometries);
}

function start(root: HTMLElement, t: T, reduced: () => boolean, THREE: Three,
  OrbitControls: typeof import('three/examples/jsm/controls/OrbitControls.js').OrbitControls,
  mergeGeometries: typeof import('three/examples/jsm/utils/BufferGeometryUtils.js').mergeGeometries): GreenhouseGame {
  const $ = <E extends Element = HTMLElement>(s: string) => root.querySelector<E>(s)!;
  const canvas = $<HTMLCanvasElement>('[data-game-canvas]');
  const abort = new AbortController(), on = {signal: abort.signal};
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (fn: () => void, ms: number) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };
  const rnd = seeded(7);
  const VARIETIES = varieties(t);
  let variety = VARIETIES.cherry;
  const varies = Array.from({length: PLANTS}, () => 0.88 + rnd() * 0.24);
  const sim = createSimulation(t, varies);

  /* ================= renderer ================= */
  const renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: true, powerPreference: 'high-performance'});
  renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const fog = new THREE.Fog(0xd9ecf8, 18, 55); scene.fog = fog;
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120);
  camera.position.set(8.5, 5, 10.5);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.85, 0);
  controls.enableDamping = true; controls.enablePan = false; controls.enableZoom = false; // never hijack page scroll
  canvas.style.touchAction = 'pan-y'; // OrbitControls sets 'none'; vertical swipes must keep scrolling the page
  controls.minPolarAngle = 0.75; controls.maxPolarAngle = 1.38; controls.rotateSpeed = 0.6;
  controls.autoRotate = !reduced(); controls.autoRotateSpeed = 0.35;
  let userRotated = false;
  controls.addEventListener('start', () => { userRotated = true; controls.autoRotate = false; });
  const resize = () => {
    const r = root.getBoundingClientRect();
    if (!r.width || !r.height) return;
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height; camera.fov = r.width < 640 ? 50 : 38; camera.updateProjectionMatrix();
  };
  const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(root);

  /* procedural textures (no downloads) */
  const noiseTex = (base: number[], spread: number, size = 128, repeat = 1) => {
    const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d')!;
    const img = g.createImageData(size, size);
    for (let i = 0; i < size * size; i++) { const n = (Math.random() - 0.5) * spread; img.data[i * 4] = base[0] + n; img.data[i * 4 + 1] = base[1] + n; img.data[i * 4 + 2] = base[2] + n * 0.8; img.data[i * 4 + 3] = 255; }
    g.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(repeat, repeat); tex.colorSpace = THREE.SRGBColorSpace; return tex;
  };

  /* lights & sky */
  const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x2a2016, 0.6); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2d6, 2);
  sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, {left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 30});
  sun.shadow.bias = -0.0005; scene.add(sun);
  const starsGeo = new THREE.BufferGeometry();
  starsGeo.setAttribute('position', new THREE.Float32BufferAttribute(Array.from({length: 600}, (_, i) => {
    const a = Math.random() * Math.PI * 2, e = 0.15 + Math.random() * 1.2, r = 50;
    return i % 3 === 0 ? Math.cos(a) * Math.cos(e) * r : i % 3 === 1 ? Math.sin(e) * r : Math.sin(a) * Math.cos(e) * r;
  }), 3));
  const starsMat = new THREE.PointsMaterial({color: 0xffffff, size: 0.14, transparent: true, opacity: 0, fog: false});
  scene.add(new THREE.Points(starsGeo, starsMat));

  /* landscape: ground, gravel, walkway, instanced grass and trees, hills */
  const ground = new THREE.Mesh(new THREE.CircleGeometry(90, 48), new THREE.MeshStandardMaterial({color: 0x3b5236, roughness: 1, map: noiseTex([70, 96, 62], 26, 128, 40)}));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const gravel = new THREE.Mesh(new THREE.PlaneGeometry(8.2, 5.6), new THREE.MeshStandardMaterial({color: 0xffffff, roughness: 0.95, map: noiseTex([128, 124, 116], 60, 128, 6)}));
  gravel.rotation.x = -Math.PI / 2; gravel.position.y = 0.006; gravel.receiveShadow = true; scene.add(gravel);
  const walk = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.1), new THREE.MeshStandardMaterial({color: 0x8e8a80, roughness: 0.9}));
  walk.rotation.x = -Math.PI / 2; walk.position.set(-5.6, 0.008, 0); walk.receiveShadow = true; scene.add(walk);
  {
    const blade = new THREE.ConeGeometry(0.018, 0.16, 3); blade.translate(0, 0.08, 0);
    const COUNT = window.innerWidth < 640 ? 2400 : 4200, grass = new THREE.InstancedMesh(blade, new THREE.MeshStandardMaterial({color: 0xffffff, roughness: 0.9}), COUNT);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
    for (let i = 0; i < COUNT; i++) {
      let x: number, z: number;
      do { x = (Math.random() - 0.5) * 30; z = (Math.random() - 0.5) * 24; } while ((Math.abs(x) < 4.3 && Math.abs(z) < 3.0) || (x < -3.4 && x > -7.8 && Math.abs(z) < 0.7));
      e.set((Math.random() - 0.5) * 0.4, Math.random() * Math.PI, (Math.random() - 0.5) * 0.4); q.setFromEuler(e);
      const s = 0.6 + Math.random() * 0.8; m4.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s * (0.8 + Math.random() * 0.6), s));
      grass.setMatrixAt(i, m4); grass.setColorAt(i, col.setHSL(0.26 + Math.random() * 0.06, 0.45, 0.28 + Math.random() * 0.14));
    }
    grass.receiveShadow = true; scene.add(grass);
    const crown = new THREE.ConeGeometry(0.9, 2.4, 7); crown.translate(0, 2.4, 0);
    const trunk = new THREE.CylinderGeometry(0.1, 0.14, 1.2, 6); trunk.translate(0, 0.6, 0);
    const TREES = 14, crowns = new THREE.InstancedMesh(crown, new THREE.MeshStandardMaterial({color: 0x2f5a3a, roughness: 0.85, flatShading: true}), TREES);
    const trunks = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({color: 0x5a4130, roughness: 0.9}), TREES);
    for (let i = 0; i < TREES; i++) {
      const a = (i / TREES) * Math.PI * 2 + Math.random() * 0.3, r = 15 + Math.random() * 9, s = 0.8 + Math.random() * 0.7;
      m4.compose(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), q.identity(), new THREE.Vector3(s, s, s));
      crowns.setMatrixAt(i, m4); trunks.setMatrixAt(i, m4);
    }
    crowns.castShadow = true; scene.add(crowns, trunks);
    const hillMat = new THREE.MeshStandardMaterial({color: 0x4f6b52, roughness: 1, flatShading: true});
    const hillGeo = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    [[-30, -40, 14], [10, -48, 18], [38, -30, 12], [-44, 10, 16]].forEach(([x, z, r]) => { const h = new THREE.Mesh(hillGeo, hillMat); h.scale.set(r, r * 0.35, r); h.position.set(x, 0, z); scene.add(h); });
  }

  /* greenhouse */
  const W = 6.4, D = 4.2, H = 2.2, RIDGE = 3.3, B = 0.14; // B: foundation height
  const metal = new THREE.MeshStandardMaterial({color: 0xd7dde6, metalness: 0.65, roughness: 0.3});
  const glass = new THREE.MeshPhysicalMaterial({color: 0xd6ecff, transparent: true, opacity: 0.12, roughness: 0.04, metalness: 0, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false});
  const concrete = new THREE.MeshStandardMaterial({color: 0xb9b6ae, roughness: 0.95});
  const house = new THREE.Group(); scene.add(house);
  const box = (w: number, h: number, d: number, mat: ThreeNS.Material, x: number, y: number, z: number) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; house.add(m); return m; };
  const bar = (len: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.07, len, 0.05), metal); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; house.add(m); return m; };
  box(W + 0.3, B, 0.2, concrete, 0, B / 2, -D / 2); box(W + 0.3, B, 0.2, concrete, 0, B / 2, D / 2);
  box(0.2, B, D, concrete, -W / 2, B / 2, 0); box(0.2, B, D, concrete, W / 2, B / 2, 0);
  const POSTS = [-W / 2, -W / 4, 0, W / 4, W / 2];
  for (const x of POSTS) for (const z of [-D / 2, D / 2]) bar(H, x, H / 2 + B, z);
  const roofLen = Math.hypot(D / 2, RIDGE - H), roofAng = Math.atan2(RIDGE - H, D / 2);
  for (const x of POSTS) { bar(roofLen, x, (H + RIDGE) / 2 + B, -D / 4, Math.PI / 2 - roofAng); bar(roofLen, x, (H + RIDGE) / 2 + B, D / 4, -(Math.PI / 2 - roofAng)); }
  for (const z of [-D / 2, D / 2]) { bar(W, 0, H + B, z, 0, 0, Math.PI / 2); bar(W, 0, 1.0, z, 0, 0, Math.PI / 2); }
  bar(W, 0, RIDGE + B, 0, 0, 0, Math.PI / 2);
  for (const z of [-D / 2 - 0.08, D / 2 + 0.08]) { const g = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, W + 0.3, 10, 1, true, 0, Math.PI), metal); g.rotation.z = Math.PI / 2; g.rotation.x = Math.PI; g.position.set(0, H + B - 0.02, z); house.add(g); }
  const pane = (w: number, h: number, pos: ThreeNS.Vector3, rot: ThreeNS.Euler) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glass); m.position.copy(pos); m.rotation.copy(rot); house.add(m); return m; };
  pane(W, H, new THREE.Vector3(0, H / 2 + B, -D / 2), new THREE.Euler());
  pane(W, H, new THREE.Vector3(0, H / 2 + B, D / 2), new THREE.Euler());
  pane(D, H, new THREE.Vector3(-W / 2, H / 2 + B, 0), new THREE.Euler(0, Math.PI / 2, 0));
  pane(D, H, new THREE.Vector3(W / 2, H / 2 + B, 0), new THREE.Euler(0, Math.PI / 2, 0));
  pane(W, roofLen, new THREE.Vector3(0, (H + RIDGE) / 2 + B, -D / 4), new THREE.Euler(Math.PI / 2 - roofAng, 0, 0));
  const ventHinge = new THREE.Group(); ventHinge.position.set(0, RIDGE + B, 0); house.add(ventHinge);
  const ventPane = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.2, roofLen), glass);
  ventPane.position.set(0, -(RIDGE - H) / 2, D / 4); ventPane.rotation.x = -(Math.PI / 2 - roofAng); ventHinge.add(ventPane);
  const ventFrame = new THREE.Mesh(new THREE.BoxGeometry(W - 0.2, 0.05, 0.05), metal); ventFrame.position.set(0, -(RIDGE - H), D / 2); ventHinge.add(ventFrame);
  const gable = new THREE.Shape(); gable.moveTo(-D / 2, 0); gable.lineTo(D / 2, 0); gable.lineTo(0, RIDGE - H); gable.closePath();
  for (const x of [-W / 2, W / 2]) { const g = new THREE.Mesh(new THREE.ShapeGeometry(gable), glass); g.position.set(x, H + B, 0); g.rotation.y = Math.PI / 2; house.add(g); }
  // door on the west gable
  const door = new THREE.Group(); door.position.set(-W / 2 - 0.02, B, 0); house.add(door);
  const df = (len: number, y: number, z: number, rot = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, len, 0.06), metal); m.position.set(0, y, z); m.rotation.x = rot; door.add(m); };
  df(1.9, 0.95, -0.45); df(1.9, 0.95, 0.45); df(0.96, 1.9, 0, Math.PI / 2);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.03), new THREE.MeshStandardMaterial({color: 0x222831, metalness: 0.6, roughness: 0.3})); handle.position.set(-0.03, 0.95, 0.32); door.add(handle);
  // fan on the east gable
  const fan = new THREE.Group(); fan.position.set(W / 2 + 0.03, 1.55, 0); fan.rotation.y = Math.PI / 2; house.add(fan);
  fan.add(new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.035, 8, 32), new THREE.MeshStandardMaterial({color: 0x2c3340, metalness: 0.5, roughness: 0.4})));
  const blades = new THREE.Group(); fan.add(blades);
  for (let i = 0; i < 5; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 0.02), metal); b.position.y = 0.15; b.rotation.y = 0.35; const p = new THREE.Group(); p.rotation.z = (i * Math.PI * 2) / 5; p.add(b); blades.add(p); }
  // control cabinet with a live status screen
  const cab = new THREE.Group(); cab.position.set(W / 2 + 0.5, 0, -1.4); scene.add(cab);
  const cabBody = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.1, 0.32), new THREE.MeshStandardMaterial({color: 0xe8eaee, roughness: 0.5, metalness: 0.2})); cabBody.position.y = 0.75; cabBody.castShadow = true; cab.add(cabBody);
  const screenMat = new THREE.MeshStandardMaterial({color: 0x0b1020, emissive: 0x2dd4bf, emissiveIntensity: 0.9});
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.2), screenMat); scr.position.set(0.251, 0.95, 0); scr.rotation.y = Math.PI / 2; cab.add(scr);
  const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.08), metal); leg.position.y = 0.1; cab.add(leg);
  // water tank with a feed pipe
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.3, 20), new THREE.MeshStandardMaterial({color: 0x3b5b8a, roughness: 0.45, metalness: 0.2}));
  tank.position.set(-W / 2 - 0.9, 0.65, -1.5); tank.castShadow = true; scene.add(tank);
  const pipeMat = new THREE.MeshStandardMaterial({color: 0x1c1c1c, roughness: 0.6});
  const tpipe = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.75, 8), pipeMat); tpipe.rotation.z = Math.PI / 2; tpipe.position.set(-W / 2 - 0.3, 0.3, -1.5); scene.add(tpipe);

  /* beds, drip lines, lamps */
  const soilDry = new THREE.Color(0xb08a62), soilWet = new THREE.Color(0x4a3220);
  const soilMat = new THREE.MeshStandardMaterial({color: soilDry.clone(), roughness: 1, map: noiseTex([150, 150, 150], 90, 128, 3)});
  const woodMat = new THREE.MeshStandardMaterial({color: 0x6b4b32, roughness: 0.85, map: noiseTex([150, 140, 130], 40, 64, 2)});
  const lampMat = new THREE.MeshStandardMaterial({color: 0x2a2030, emissive: 0xff4fd8, emissiveIntensity: 0});
  const BEDS = [-0.95, 0.95], PLANTS_X = [-2.2, -1.1, 0, 1.1, 2.2];
  const growLights: ThreeNS.PointLight[] = [], leds: ThreeNS.Mesh<ThreeNS.BufferGeometry, ThreeNS.MeshStandardMaterial>[] = [];
  BEDS.forEach((z) => {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.36, 1.0), woodMat); frame.position.set(0, 0.2, z); frame.castShadow = frame.receiveShadow = true; scene.add(frame);
    const soil = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.04, 0.84), soilMat); soil.position.set(0, 0.39, z); soil.receiveShadow = true; scene.add(soil);
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 5.4, 8), pipeMat); pipe.rotation.z = Math.PI / 2; pipe.position.set(0, 0.43, z + 0.22); scene.add(pipe);
    for (const x of [-1.8, 0, 1.8]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.05, 0.16), lampMat); l.position.set(x, 2.05, z); scene.add(l);
      const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.3), metal); wire.position.set(x, 2.22, z); scene.add(wire);
    }
    const pl = new THREE.PointLight(0xff5ad9, 0, 6, 1.6); pl.position.set(0, 1.9, z); scene.add(pl); growLights.push(pl);
    const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5), metal); stake.position.set(2.65, 0.62, z - 0.3); scene.add(stake);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 12), new THREE.MeshStandardMaterial({color: 0x0, emissive: 0x2dd4bf, emissiveIntensity: 2})); led.position.set(2.65, 0.89, z - 0.3); scene.add(led); leds.push(led);
  });
  const DROPS = 260, dropPos = new Float32Array(DROPS * 3), dropVel = new Float32Array(DROPS);
  const dropGeo = new THREE.BufferGeometry(); dropGeo.setAttribute('position', new THREE.BufferAttribute(dropPos, 3));
  const resetDrop = (i: number, spawn: boolean) => { dropPos[i * 3] = (Math.random() - 0.5) * 5.2; dropPos[i * 3 + 1] = spawn ? 1.9 + Math.random() * 0.3 : -5; dropPos[i * 3 + 2] = BEDS[i % 2] + (Math.random() - 0.5) * 0.6; dropVel[i] = 1.6 + Math.random() * 1.2; };
  for (let i = 0; i < DROPS; i++) resetDrop(i, false);
  scene.add(new THREE.Points(dropGeo, new THREE.PointsMaterial({color: 0x8fd6ff, size: 0.045, transparent: true, opacity: 0.85, depthWrite: false})));
  const sprinklerMat = new THREE.MeshStandardMaterial({color: 0x3b82f6, emissive: 0x1d4ed8, emissiveIntensity: 0});
  BEDS.forEach((z) => { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 5.4, 6), sprinklerMat); s.rotation.z = Math.PI / 2; s.position.set(0, 2.0, z + 0.28); scene.add(s); });

  /* plants: compound leaves (merged leaflets), stakes, fruit trusses with calyx */
  const leaflet = (len: number, wid: number) => {
    const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.bezierCurveTo(len * 0.25, wid, len * 0.7, wid * 0.9, len, 0); sh.bezierCurveTo(len * 0.7, -wid * 0.9, len * 0.25, -wid, 0, 0);
    const g = new THREE.ShapeGeometry(sh, 6); g.rotateX(-Math.PI / 2); return g.toNonIndexed();
  };
  const compound = (() => {
    const parts: ThreeNS.BufferGeometry[] = [];
    const tip = leaflet(0.12, 0.045); tip.translate(0.24, 0, 0); parts.push(tip);
    ([[0.08, 0.09, 0.035], [0.17, 0.08, 0.03]] as const).forEach(([x, l, w]) => { for (const sgn of [1, -1]) { const g = leaflet(l, w); g.rotateY(sgn * 1.0); g.translate(x, 0, 0); parts.push(g); } });
    const rach = new THREE.BoxGeometry(0.26, 0.006, 0.008).toNonIndexed(); rach.translate(0.13, 0, 0);
    rach.deleteAttribute('uv'); parts.forEach((p) => p.deleteAttribute('uv')); parts.push(rach);
    const g = mergeGeometries(parts)!;
    const pos = g.attributes.position; // gentle arch
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i); pos.setY(i, pos.getY(i) + 0.12 * x - 0.45 * x * x); }
    g.computeVertexNormals(); return g;
  })();
  const fruitGeo = new THREE.SphereGeometry(1, 12, 10), calyxGeo = new THREE.ConeGeometry(0.4, 0.35, 5); calyxGeo.translate(0, 1.05, 0);
  const stakeMat = new THREE.MeshStandardMaterial({color: 0x9a7b55, roughness: 0.9});
  const calyxMat = new THREE.MeshStandardMaterial({color: 0x2f7a35, roughness: 0.8});
  const stemMat = new THREE.MeshStandardMaterial({color: 0x4f8f3a, roughness: 0.8});
  const green = new THREE.Color(0x3fa34d), dryLeaf = new THREE.Color(0xb59a3a), dead = new THREE.Color(0x6b5530);
  type Plant = {stem: ThreeNS.Mesh; leaves: {pivot: ThreeNS.Group; leaf: ThreeNS.Mesh; at: number}[]; fruits: ThreeNS.Group[]; leafMat: ThreeNS.MeshStandardMaterial; fruitMat: ThreeNS.MeshStandardMaterial};
  const plants: Plant[] = [];
  BEDS.forEach((z, bi) => PLANTS_X.forEach((x, pi) => {
    const g = new THREE.Group(); g.position.set(x + (rnd() - 0.5) * 0.15, 0.41, z + (rnd() - 0.5) * 0.12); scene.add(g);
    const stake = new THREE.Mesh(new THREE.BoxGeometry(0.022, 1.65, 0.022), stakeMat); stake.position.set(0.07, 0.82, 0.05); stake.castShadow = true; g.add(stake);
    const leafMat = new THREE.MeshStandardMaterial({color: green.clone(), roughness: 0.65, side: THREE.DoubleSide});
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.028, 1, 6), stemMat); stem.castShadow = true; g.add(stem);
    const leaves = Array.from({length: 12}, (_, i) => {
      const pivot = new THREE.Group(); pivot.rotation.y = i * 2.4 + pi; g.add(pivot);
      const leaf = new THREE.Mesh(compound, leafMat); leaf.castShadow = true; pivot.add(leaf);
      return {pivot, leaf, at: (i + 1) / 13};
    });
    const fruitMat = new THREE.MeshStandardMaterial({color: 0x4caf50, roughness: 0.32});
    const fruits = Array.from({length: 9}, (_, i) => {
      const f = new THREE.Group(); const body = new THREE.Mesh(fruitGeo, fruitMat); body.castShadow = true; f.add(body); f.add(new THREE.Mesh(calyxGeo, calyxMat));
      f.userData = {a: i * 0.7 + bi, h: 0.42 + (i % 3) * 0.13}; g.add(f); return f;
    });
    plants.push({stem, leaves, fruits, leafMat, fruitMat});
  }));

  /* ================= live game state & HUD ================= */
  let S = newState();
  let speed = 1;
  const hud = {
    time: $('[data-h="time"]'), light: $('[data-h="light"]'), temp: $('[data-h="temp"]'), moist: $('[data-h="moist"]'),
    lightBar: $('[data-hb="light"]'), tempBar: $('[data-hb="temp"]'), moistBar: $('[data-hb="moist"]'),
    growth: $('[data-h="growth"]'), growthRing: $<SVGCircleElement>('[data-hb="growth"]'), health: $('[data-h="health"]'), healthBar: $('[data-hb="health"]'),
    variety: $('[data-h="variety"]'), cost: $('[data-h="cost"]'), energy: $('[data-h="energy"]'), energyBar: $('[data-hb="energy"]'),
  };
  const btn = {pump: $<HTMLButtonElement>('[data-act="pump"]'), lamps: $<HTMLButtonElement>('[data-act="lamps"]'), vent: $<HTMLButtonElement>('[data-act="vent"]'), auto: $<HTMLButtonElement>('[data-act="auto"]')};
  const toggles: Toggle[] = ['pump', 'lamps', 'vent'];
  const toastBox = $('[data-toasts]');
  const toast = (text: string, kind = '') => {
    const el = document.createElement('div'); el.className = `game-toast ${kind}`; el.textContent = text;
    toastBox.prepend(el); while (toastBox.children.length > 2) toastBox.lastElementChild!.remove();
    later(() => el.classList.add('out'), 3200); later(() => el.remove(), 3800);
  };
  const syncButtons = () => {
    for (const k of toggles) { btn[k].setAttribute('aria-pressed', String(S[k])); btn[k].disabled = S.auto; }
    btn.auto.setAttribute('aria-checked', String(S.auto)); root.classList.toggle('is-auto', S.auto);
  };
  const TXT: Record<Toggle, [string, string]> = {
    pump: [t('полив включён', 'irrigation on'), t('полив выключен', 'irrigation off')],
    lamps: [t('досветка включена', 'grow lights on'), t('досветка выключена', 'grow lights off')],
    vent: [t('вентиляция включена', 'ventilation on'), t('вентиляция выключена', 'ventilation off')],
  };
  const applyAuto = () => {
    const want = sim.autopilot(S, variety);
    for (const k of toggles) if (want[k] !== S[k]) {
      S[k] = want[k];
      const why = k === 'pump' ? fill(t('влажность {moisture}%','moisture {moisture}%'),{moisture:Math.round(S.moisture)}) : k === 'vent' ? `${S.temp.toFixed(0)}°` : want[k] ? t('мало солнца', 'low sunlight') : t('хватает света', 'enough light');
      toast(fill(t('Автопилот: {action}, {why}','Autopilot: {action}, {why}'),{action:TXT[k][want[k] ? 0 : 1],why:why}), 'auto');
    }
    syncButtons();
  };
  for (const k of toggles) btn[k].addEventListener('click', () => { if (S.auto || S.over || !S.running) return; S.actions++; S[k] = !S[k]; syncButtons(); }, on);
  btn.auto.addEventListener('click', () => {
    S.auto = !S.auto; S.usedAuto = S.usedAuto || S.auto;
    toast(S.auto ? t('Автопилот включён: правила управляют поливом, светом и вентиляцией', 'Autopilot on: rules now control irrigation, light and ventilation') : t('Ручное управление: теперь всё зависит от вас', 'Manual control: it is all up to you now'), 'auto');
    syncButtons();
  }, on);
  root.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) => b.addEventListener('click', () => { speed = Number(b.dataset.speed); root.querySelectorAll('[data-speed]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }, on));
  root.querySelectorAll<HTMLButtonElement>('[data-variety]').forEach((b) => b.addEventListener('click', () => {
    variety = VARIETIES[b.dataset.variety!] ?? VARIETIES.cherry; root.querySelectorAll('[data-variety]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }, on));

  const startOverlay = $('[data-overlay="start"]'), endOverlay = $('[data-overlay="end"]');
  // Controls behind an open overlay stay out of the tab order.
  const playArea = root.querySelectorAll<HTMLElement>('.game-controls,.game-hud');
  const syncInert = () => { const open = !startOverlay.hidden || !endOverlay.hidden; playArea.forEach((node) => { node.inert = open; }); };
  const begin = (auto: boolean) => {
    S = newState(); S.auto = auto; S.usedAuto = auto; S.running = true;
    startOverlay.hidden = true; endOverlay.hidden = true; syncInert(); syncButtons();
    hud.variety.textContent = variety.name;
    toast(auto ? fill(t('Автопилот ведёт сорт «{name}». Наблюдайте за решениями.','The autopilot is growing {name}. Watch its decisions.'),{name:variety.name}) : fill(t('День 1, 08:00. Сорт «{name}» посажен. Удачи!','Day 1, 08:00. {name} is planted. Good luck!'),{name:variety.name}));
    btn.pump.focus({preventScroll: true});
  };
  const backToStart = () => { endOverlay.hidden = true; startOverlay.hidden = false; syncInert(); S = newState(); syncButtons(); root.querySelector<HTMLButtonElement>('[data-variety][aria-pressed="true"]')?.focus({preventScroll: true}); };
  root.querySelectorAll<HTMLButtonElement>('[data-begin]').forEach((b) => b.addEventListener('click', () => begin(b.dataset.begin === 'auto'), on));
  root.querySelectorAll('[data-choose],[data-restart]').forEach((b) => b.addEventListener('click', backToStart, on));

  const money = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(v).toFixed(2)}`;
  const el = (tag: string, text?: string, children: Node[] = []) => { const n = document.createElement(tag); if (text) n.textContent = text; children.forEach((c) => n.append(c)); return n; };
  const finish = (win: boolean) => {
    S.running = false; S.over = true;
    const me = sim.economics(S, variety, win);
    const auto = sim.replay(sim.autopilot, variety), manual = sim.replay(sim.typicalManual, variety);
    const asAuto = S.usedAuto && S.actions === 0;
    $('[data-end-title]').textContent = win ? fill(t('Урожай собран: {kg} кг','Harvest in: {kg} kg'),{kg:me.kg.toFixed(1)}) : t('Растения погибли', 'The plants died');
    $('[data-end-text]').textContent = win
      ? fill(t('Сорт «{name}», {days} дн. ','{name}, {days} days. '),{name:variety.name,days:me.days.toFixed(1)}) + (asAuto ? t('Автопилот справился без единого вашего действия.', 'The autopilot managed without a single action from you.') : fill(t('Ваших вмешательств: {actions}.','Your interventions: {actions}.'),{actions:S.actions}))
      : fill(t('{stress}. Урожая нет, а расходы на воду и энергию уже понесены.','{stress}. There is no harvest, but water and energy are already paid for.'),{stress:S.stress});
    const stats = [
      [t('Урожай', 'Harvest'), fill(t('{kg} кг','{kg} kg'),{kg:me.kg.toFixed(1)})], [t('Выручка', 'Revenue'), money(me.revenue)],
      [t('Энергия', 'Energy'), fill(t('{energy} кВт·ч · {energyCost}','{energy} kWh · {energyCost}'),{energy:me.energy.toFixed(0),energyCost:money(me.energyCost)})],
      [t('Вода', 'Water'), fill(t('{water} л · {waterCost}','{water} L · {waterCost}'),{water:Math.round(me.water),waterCost:money(me.waterCost)})], [t('Прибыль', 'Profit'), money(me.profit)],
    ];
    $('[data-end-stats]').replaceChildren(...stats.map(([k, v]) => el('div', undefined, [el('span', k), el('b', v)])));
    const diff = asAuto ? me.profit - manual.profit : auto.profit - me.profit;
    const eSave = asAuto ? manual.energyCost - me.energyCost : me.energyCost - auto.energyCost;
    const wSave = asAuto ? manual.waterCost - me.waterCost : me.waterCost - auto.waterCost;
    let title: string, body: string;
    if (asAuto) {
      title = t('Автопилот против типичного ручного режима', 'Autopilot versus a typical manual routine');
      const manualRes = manual.harvested ? fill(t('даёт {kg} кг и прибыль {profit}','yields {kg} kg and {profit} profit'),{kg:manual.kg.toFixed(1),profit:money(manual.profit)}) : t('теряет урожай', 'loses the harvest');
      const energy = eSave > 0.005 ? fill(t('энергия дешевле на {eSave}','energy {eSave} cheaper'),{eSave:money(eSave)}) : t('энергия на том же уровне', 'energy at the same level');
      const water = wSave > 0.005 ? fill(t('вода дешевле на {wSave}','water {wSave} cheaper'),{wSave:money(wSave)}) : t('вода на том же уровне', 'water at the same level');
      const saved = manual.harvested ? '' : t(', а главное, урожай сохранён', ', and above all the harvest survived');
      body = fill(t('В тех же условиях ручной режим {manualRes}. Автопилот вырастил на {kg} кг больше и заработал больше на {diff}: {energy}, {water}{saved}.', 'Under the same conditions the manual routine {manualRes}. The autopilot grew {kg} kg more and earned {diff} more: {energy}, {water}{saved}.'),
        {manualRes, kg: Math.max(0, me.kg - manual.kg).toFixed(1), diff: money(Math.max(0, diff)), energy, water, saved});
    } else if (!win) {
      title = t('Автопилот сохранил бы урожай', 'The autopilot would have saved the harvest');
      body = fill(t('В тех же условиях: {kg} кг за {days} дн. и прибыль {profit}. Система круглосуточно следит за почвой и климатом и реагирует сразу.', 'Under the same conditions: {kg} kg in {days} days and {profit} profit. The system watches soil and climate around the clock and reacts straight away.'),
        {kg: auto.kg.toFixed(1), days: auto.days.toFixed(1), profit: money(auto.profit)});
    } else {
      title = t('Что сделал бы автопилот в тех же условиях', 'What the autopilot would do under the same conditions');
      const verdict = diff > 0.005 ? fill(t('Это на {diff} больше вашего результата','That is {diff} more than your result'),{diff:money(diff)}) : t('Вы сыграли не хуже автопилота, отличный результат', 'You matched the autopilot, a great result');
      const energySaving = eSave > 0.005 ? fill(t(', энергия дешевле на {eSave}', ', energy {eSave} cheaper'), {eSave: money(eSave)}) : '';
      const waterSaving = wSave > 0.005 ? fill(t(', вода дешевле на {wSave}', ', water {wSave} cheaper'), {wSave: money(wSave)}) : '';
      body = fill(t('{kg} кг за {days} дн., прибыль {profit}. {verdict}{energySaving}{waterSaving}.', '{kg} kg in {days} days, {profit} profit. {verdict}{energySaving}{waterSaving}.'),
        {kg: auto.kg.toFixed(1), days: auto.days.toFixed(1), profit: money(auto.profit), verdict, energySaving, waterSaving});
    }
    $('[data-end-compare]').replaceChildren(el('b', title), el('p', body));
    endOverlay.dataset.win = String(win);
    endOverlay.hidden = false; syncInert();
    root.querySelector<HTMLButtonElement>('[data-overlay="end"] [data-begin]')?.focus({preventScroll: true});
  };

  const step = (dtH: number) => {
    if (S.auto) applyAuto();
    const sunK = sim.physics(S, variety, dtH);
    if (!S.auto) {
      const warn = (key: string, cond: boolean, text: string) => { if (cond && !S.flags[key]) { S.flags[key] = true; toast(text, 'warn'); } if (!cond) S.flags[key] = false; };
      warn('dry', S.moisture < 28, fill(t('Почва пересыхает: {moisture}%. Включите полив','The soil is drying out: {moisture}%. Turn on irrigation'),{moisture:Math.round(S.moisture)}));
      warn('wet', S.moisture > 86, fill(t('Слишком много воды: {moisture}%. Выключите полив','Too much water: {moisture}%. Turn irrigation off'),{moisture:Math.round(S.moisture)}));
      warn('hot', S.temp > variety.heatMax - 3, fill(t('Жарко: {temp}°. Включите вентиляцию','Hot: {temp}°. Turn on ventilation'),{temp:S.temp.toFixed(0)}));
      warn('cold', S.temp < 14, fill(t('Холодно: {temp}°. Выключите вентиляцию','Cold: {temp}°. Turn ventilation off'),{temp:S.temp.toFixed(0)}));
      warn('dark', S.hour > 7 && S.hour < 19 && S.light < 0.3, t('Растениям не хватает света', 'The plants need more light'));
    }
    if (S.energy > BUDGET_KWH && !S.flags.budget) { S.flags.budget = true; toast(fill(t('Бюджет энергии {budget} кВт·ч превышен','Energy budget of {budget} kWh exceeded'),{budget:BUDGET_KWH}), 'warn'); }
    const a = avgGrowth(S);
    if (S.health <= 0) finish(false); else if (a >= 0.999) finish(true);
    return {sunK, avg: a};
  };

  /* ================= visuals per frame ================= */
  const daySky = [new THREE.Color(0x6fb4ea), new THREE.Color(0xd9ecf8)], nightSky = [new THREE.Color(0x05070f), new THREE.Color(0x182044)], duskSky = [new THREE.Color(0x3b3f8f), new THREE.Color(0xf4a46a)];
  const skyColor = (sunK: number) => { const dusk = Math.max(0, 1 - Math.abs(sunK - 0.12) / 0.15) * (sunK > 0 ? 1 : 0); return [0, 1].map((i) => nightSky[i].clone().lerp(daySky[i], ramp(sunK, 0, 0.45)).lerp(duskSky[i], dusk * 0.6)); };
  const unit = t('кВт·ч', 'kWh');
  let hudAcc = 0, sunK = 0, avg = 0, intro = 0, now = 0;
  const visuals = (dt: number) => {
    const ang = ((S.hour - 6) / 12) * Math.PI;
    sun.position.set(Math.cos(ang) * 12, Math.max(-2, Math.sin(ang) * 12), 5);
    sun.intensity = sunK * 2.4; hemi.intensity = 0.25 + sunK * 0.55;
    starsMat.opacity = 1 - ramp(sunK, 0, 0.2);
    const [top, bottom] = skyColor(sunK);
    fog.color.copy(bottom);
    root.style.setProperty('--sky-top', `#${top.getHexString()}`); root.style.setProperty('--sky-bottom', `#${bottom.getHexString()}`);
    lampMat.emissiveIntensity = lerp(lampMat.emissiveIntensity, S.lamps ? 2.2 : 0, 0.15);
    growLights.forEach((l) => (l.intensity = lampMat.emissiveIntensity * 2.2));
    ventHinge.rotation.x = lerp(ventHinge.rotation.x, S.vent ? -0.45 : 0, 0.08);
    blades.rotation.z += (S.vent ? 0.4 : 0.005) * (dt / 16) * (reduced() ? 0.3 : 1);
    soilMat.color.copy(soilDry).lerp(soilWet, ramp(S.moisture, 15, 85));
    sprinklerMat.emissiveIntensity = S.pump ? 1.2 : 0;
    const status = S.health < 40 || S.stressNow ? 0xf87171 : S.flags.dry || S.flags.wet || S.flags.hot || S.flags.cold ? 0xfbbf24 : 0x2dd4bf;
    leds.forEach((l) => { l.material.emissive.setHex(status); l.material.emissiveIntensity = 1.5 + Math.sin(now / 300) * 0.8; });
    screenMat.emissive.setHex(status); screenMat.emissiveIntensity = 0.7 + Math.sin(now / 500) * 0.15;
    const dts = dt / 1000;
    for (let i = 0; i < DROPS; i++) {
      if (dropPos[i * 3 + 1] < 0.42) { if (S.pump && Math.random() < 0.08) resetDrop(i, true); else { dropPos[i * 3 + 1] = -5; continue; } }
      dropPos[i * 3 + 1] -= dropVel[i] * dts * 1.6;
    }
    dropGeo.attributes.position.needsUpdate = true;
    const hk = S.health / 100, F = variety.fruit;
    const leafColor = dead.clone().lerp(dryLeaf, ramp(hk, 0, 0.5)).lerp(green, ramp(hk, 0.5, 0.95));
    plants.forEach((p, idx) => {
      const g = S.growth[idx], height = 0.12 + g * 1.3;
      p.stem.scale.set(0.6 + g * 0.6, height, 0.6 + g * 0.6); p.stem.position.y = height / 2;
      p.stem.rotation.z = (1 - hk) * 0.25 * (idx % 2 ? 1 : -1) + Math.sin(now / 1400 + idx) * 0.015;
      p.leafMat.color.lerp(leafColor, 0.1);
      p.leaves.forEach((L, i) => {
        const vis = clamp((g * 13 - i) / 2, 0, 1);
        L.pivot.position.y = L.at * height;
        L.leaf.scale.setScalar(Math.max(0.0001, vis * (0.8 + 0.7 * (1 - L.at)) * (0.75 + g * 0.6)));
        L.leaf.rotation.z = 0.32 - (1 - hk) * 1.2 + Math.sin(now / 900 + i + idx) * 0.04;
      });
      const ripe = ramp(g, 0.72, 1);
      p.fruits.forEach((f, i) => {
        const fv = i < F.n ? clamp((g - 0.58 - (i / F.n) * 0.12) / 0.12, 0, 1) : 0;
        const r = F.r * fv * (0.6 + g * 0.5);
        f.scale.set(Math.max(0.0001, r), Math.max(0.0001, r * F.sy), Math.max(0.0001, r));
        const ring = F.n > 6 ? 0.1 : 0.14;
        f.position.set(Math.cos(f.userData.a) * ring, f.userData.h * height - (i % 3) * 0.03, Math.sin(f.userData.a) * ring);
      });
      p.fruitMat.color.setHSL(lerp(0.27, F.hue, ripe), 0.75, lerp(0.36, F.hue > 0.5 ? 0.55 : 0.45, ripe));
    });
    hudAcc += dt;
    if (hudAcc > 100) {
      hudAcc = 0;
      const hh = Math.floor(S.hour), mm = Math.floor(((S.hour - hh) * 60) / 10) * 10;
      const clock = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      hud.time.textContent = fill(t('День {day} · {clock}','Day {day} · {clock}'),{day:S.day,clock:clock});
      hud.light.textContent = S.light < 0.05 ? t('темно', 'dark') : `${Math.round(S.light * 100)}%`;
      hud.temp.textContent = `${S.temp.toFixed(1)}°`; hud.moist.textContent = `${Math.round(S.moisture)}%`;
      hud.lightBar.style.width = `${clamp(S.light / 1.2, 0, 1) * 100}%`;
      hud.tempBar.style.width = `${ramp(S.temp, 5, 40) * 100}%`; hud.moistBar.style.width = `${S.moisture}%`;
      hud.moistBar.dataset.state = S.moisture < 28 || S.moisture > 86 ? 'warn' : 'ok';
      hud.tempBar.dataset.state = S.temp > variety.heatMax - 3 || S.temp < 14 ? 'warn' : 'ok';
      hud.growth.textContent = `${Math.round(avg * 100)}%`; hud.growthRing.style.strokeDashoffset = (125.6 * (1 - avg)).toFixed(1);
      hud.health.textContent = `${Math.round(S.health)}%`; hud.healthBar.style.width = `${S.health}%`; hud.healthBar.dataset.state = S.health < 50 ? 'warn' : 'ok';
      hud.cost.textContent = money(S.energy * TARIFF + S.water * WATER);
      hud.energy.textContent = `${S.energy.toFixed(0)} / ${BUDGET_KWH} ${unit}`;
      hud.energyBar.style.width = `${clamp(S.energy / BUDGET_KWH, 0, 1) * 100}%`; hud.energyBar.dataset.state = S.energy > BUDGET_KWH * 0.85 ? 'warn' : 'ok';
    }
  };

  /* ================= loop (driven by main.ts while the stage is visible) ================= */
  const introFrom = new THREE.Vector3(8.5, 5, 10.5), introWide = new THREE.Vector3(5.4, 2.7, 6.8), introNarrow = new THREE.Vector3(7.6, 4.2, 9.8);
  const frame = (dt: number) => {
    now += dt;
    if (S.running) { const r = step((dt / 1000) * HOURS_PER_SEC * speed); sunK = r.sunK; avg = r.avg; }
    else { sunK = sunOf(S.hour); avg = avgGrowth(S); }
    if (intro < 1) { intro = reduced() ? 1 : Math.min(1, intro + dt / 2200); camera.position.lerpVectors(introFrom, root.clientWidth < 640 ? introNarrow : introWide, settle(intro)); }
    controls.autoRotate = !userRotated && !reduced();
    controls.update(); visuals(dt); renderer.render(scene, camera);
  };
  resize();
  syncInert(); syncButtons(); hud.variety.textContent = variety.name; visuals(16); renderer.render(scene, camera);
  root.dataset.ready = 'true';

  return {
    frame,
    // Inspection hook for tests: run N game hours without waiting for real frames.
    simulate(hours: number) { const steps = Math.ceil(((hours / HOURS_PER_SEC) * 1000) / 50); for (let i = 0; i < steps && !S.over; i++) frame(50); return {avg, over: S.over}; },
    destroy() {
      abort.abort(); timers.forEach(clearTimeout); timers.clear(); resizeObserver.disconnect(); controls.dispose();
      scene.traverse((obj) => {
        const mesh = obj as ThreeNS.Mesh;
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
        mats.forEach((m) => { (m as ThreeNS.MeshStandardMaterial).map?.dispose(); m.dispose(); });
      });
      renderer.dispose();
      delete root.dataset.ready;
    },
  };
}
