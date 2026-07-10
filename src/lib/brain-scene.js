// Cena three.js do cérebro do vault — imperativa, sem React (o componente
// VaultBrain só cria/destrói e injeta dados). Estética: partículas aditivas
// ciano com bloom (UnrealBloomPass) sobre fundo #050a14, núcleo estilo arc
// reactor no centro, layout força-dirigido 3D via d3-force-3d.
//
// Todos os assets são procedurais — nada externo (COEP require-corp).

import {
  Scene, PerspectiveCamera, WebGLRenderer, FogExp2, Color, Vector2, Vector3,
  BufferGeometry, BufferAttribute, Points, ShaderMaterial, AdditiveBlending,
  LineSegments, LineBasicMaterial, Group, Mesh, SphereGeometry, TorusGeometry,
  MeshBasicMaterial, Raycaster,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { forceSimulation, forceManyBody, forceLink, forceCenter, forceRadial } from 'd3-force-3d';

const BG = 0x050a14;
const ACCENT = 0x00d4ff;
const NUCLEUS_RADIUS = 22; // zona de exclusão — nós são empurrados pra fora

// Constantes de ajuste visual/perf da Fase 5 — ajustáveis a quente no dev.
const TUNING = {
  // Fresnel do núcleo (Task 2)
  FRESNEL_POWER: 2.2,      // expoente do rim — maior = borda mais fina
  FRESNEL_BOOST: 1.8,      // intensidade do brilho de borda
  FRESNEL_BASE: 0.35,      // preenchimento interno (evita núcleo "oco")
  RING_EMISSIVE: 1.6,      // multiplicador de brilho do anel mais interno
  RING_FALLOFF: 0.28,      // quanto cada anel externo escurece (0..1)
  // Halo dos nós (Task 3)
  HALO_CORE: 0.26,         // raio do disco brilhante dentro do sprite (0..0.5)
  HALO_SOFTNESS: 0.5,      // força do halo suave até a borda do sprite
  // Gradiente dos links (Task 4)
  LINK_GRADIENT_MIN: 0.06, // brilho no endpoint de menor grau
  LINK_GRADIENT_MAX: 0.30, // brilho no endpoint de maior grau
  LINK_HOT: 0.6,           // brilho de link destacado (hover/seleção)
  // Dolly de entrada (Task 5)
  DOLLY_START: 240,        // distância inicial da câmera
  DOLLY_MS: 1500,          // duração do ease-out
  // Perf (Task 7)
  FRAME_BUDGET_MS: 20,     // acima disso por N frames → baixa o pixelRatio
  PIXEL_RATIO_LOW: 1.5,    // pixelRatio degradado
  IDLE_FPS: 30,            // fps em repouso (throttle)
};

const NODE_VERT = `
  attribute float aSize;
  attribute float aIntensity;
  attribute float aSeed;
  varying float vIntensity;
  varying float vSeed;
  void main() {
    vIntensity = aIntensity;
    vSeed = aSeed;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (300.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const NODE_FRAG = `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uHaloCore;
  uniform float uHaloSoftness;
  varying float vIntensity;
  varying float vSeed;
  void main() {
    float dist = length(gl_PointCoord - vec2(0.5));
    if (dist > 0.5) discard;
    float coreDisc = 1.0 - smoothstep(uHaloCore * 0.5, uHaloCore, dist);
    float halo = (1.0 - smoothstep(uHaloCore, 0.5, dist)) * uHaloSoftness;
    float alpha = coreDisc + halo;
    float twinkle = 0.85 + 0.15 * sin(uTime * (1.5 + fract(vSeed) * 2.0) + vSeed * 6.28);
    gl_FragColor = vec4(uColor * vIntensity * twinkle, alpha);
  }
`;

const CORE_VERT = `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const CORE_FRAG = `
  uniform vec3 uColor;
  uniform float uFresnelPower;
  uniform float uFresnelBoost;
  uniform float uBase;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float f = pow(1.0 - clamp(dot(vNormal, vView), 0.0, 1.0), uFresnelPower);
    float intensity = uBase + f * uFresnelBoost;
    gl_FragColor = vec4(uColor * intensity, 1.0);
  }
`;

function baseIntensity(node, maxDegree) {
  if (node.ghost) return 0.15;
  return 0.35 + 0.65 * Math.sqrt(node.degree / Math.max(1, maxDegree));
}

export function createBrainScene(container, { onSelect } = {}) {
  const width = container.clientWidth || 800;
  const height = container.clientHeight || 500;

  const mediaQuery = typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;
  let prefersReducedMotion = !!mediaQuery?.matches;
  const onReducedMotionChange = (e) => {
    prefersReducedMotion = e.matches;
    controls.autoRotate = !e.matches; // reflete em runtime
  };
  // (o addEventListener vai após a criação de `controls`, no Step 3)

  const scene = new Scene();
  // scene.background (Color gerenciado) em vez de setClearColor — o clear
  // color cru é re-codificado pra sRGB pelo OutputPass e lavaria o preto.
  scene.background = new Color(BG);
  scene.fog = new FogExp2(BG, 0.006);

  const camera = new PerspectiveCamera(55, width / height, 0.1, 1000);

  // Dolly state — declare before assignment in init block below
  let dollyT = 1;            // 1 = concluído (default: sem dolly)
  let dollyStart = 0;
  let dollyCancelled = false;

  const SETTLE_DIST = 140;
  if (!prefersReducedMotion) {
    camera.position.set(0, 25, TUNING.DOLLY_START);
    dollyT = 0;
    dollyStart = performance.now();
  } else {
    camera.position.set(0, 25, SETTLE_DIST);
  }

  const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  container.appendChild(renderer.domElement);

  const hoverLabel = document.createElement('div');
  hoverLabel.style.cssText = [
    'position:absolute', 'pointer-events:none', 'z-index:3', 'display:none',
    'font-size:10px', 'letter-spacing:0.12em', 'color:#c8e8f8',
    'background:rgba(5,10,20,0.85)', 'border:1px solid rgba(0,212,255,0.26)',
    'padding:3px 8px', 'white-space:nowrap', 'transform:translate(12px,-8px)',
  ].join(';');
  container.appendChild(hoverLabel);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.autoRotate = true;
  if (prefersReducedMotion) controls.autoRotate = false;
  controls.autoRotateSpeed = 0.3;
  controls.minDistance = 25;
  controls.maxDistance = 320;
  mediaQuery?.addEventListener?.('change', onReducedMotionChange);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(new Vector2(width, height), 1.2, 0.7, 0.1);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());

  // ── Núcleo arc reactor ────────────────────────────────────────────────
  const nucleus = new Group();
  const coreMat = new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(ACCENT) },
      uFresnelPower: { value: TUNING.FRESNEL_POWER },
      uFresnelBoost: { value: TUNING.FRESNEL_BOOST },
      uBase: { value: TUNING.FRESNEL_BASE },
    },
    vertexShader: CORE_VERT,
    fragmentShader: CORE_FRAG,
  });
  const core = new Mesh(new SphereGeometry(4.5, 32, 32), coreMat);
  const coreInner = new Mesh(new SphereGeometry(1.8, 24, 24), new MeshBasicMaterial({ color: 0xffffff }));
  nucleus.add(core, coreInner);
  const rings = [8, 11, 14].map((r, i) => {
    const k = TUNING.RING_EMISSIVE * (1 - i * TUNING.RING_FALLOFF);
    const ring = new Mesh(
      new TorusGeometry(r, 0.12, 8, 96),
      new MeshBasicMaterial({
        color: new Color(ACCENT).multiplyScalar(k),
        transparent: true,
        opacity: 0.5 - i * 0.1,
        blending: AdditiveBlending,
        depthWrite: false,
      })
    );
    ring.rotation.x = Math.PI / 2 + (i - 1) * 0.4;
    nucleus.add(ring);
    return ring;
  });
  // Esfera de ondulação — visível só enquanto o JARVIS fala
  const ripple = new Mesh(
    new SphereGeometry(5, 24, 24),
    new MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0, depthWrite: false })
  );
  nucleus.add(ripple);
  scene.add(nucleus);

  // ── Estado mutável ────────────────────────────────────────────────────
  let points = null;
  let lines = null;
  let sim = null;
  let simNodes = [];
  let simLinks = [];
  let neighborsOf = new Map();
  let maxDegree = 1;
  let settled = false;
  let pulse = { thinking: false, speaking: false };
  let hoveredIndex = -1;
  let selectedIndex = -1;
  let focusTarget = null;
  let disposed = false;
  let rafId = 0;
  let lastFrameStamp = performance.now();
  let slowFrames = 0, fastFrames = 0, lowRatio = false;
  let lastRenderStamp = 0;

  const raycaster = new Raycaster();
  raycaster.params.Points = { threshold: 1.5 };
  const pointerNDC = new Vector2(-2, -2);
  let pointerDirty = false;
  let downPos = null;

  function clearGraphObjects() {
    if (points) {
      scene.remove(points);
      points.geometry.dispose();
      points.material.dispose();
      points = null;
    }
    if (lines) {
      scene.remove(lines);
      lines.geometry.dispose();
      lines.material.dispose();
      lines = null;
    }
    if (sim) { sim.stop(); sim = null; }
  }

  function setGraph(graph, cachedPositions) {
    clearGraphObjects();
    simNodes = graph.nodes.map(n => ({ ...n }));
    const idx = new Map(simNodes.map((n, i) => [n.id, i]));
    simLinks = graph.links
      .filter(l => idx.has(l.source) && idx.has(l.target))
      .map(l => ({ source: l.source, target: l.target }));
    maxDegree = simNodes.reduce((a, n) => Math.max(a, n.degree || 0), 1);

    neighborsOf = new Map();
    for (const l of simLinks) {
      const si = idx.get(l.source), ti = idx.get(l.target);
      if (!neighborsOf.has(si)) neighborsOf.set(si, new Set());
      if (!neighborsOf.has(ti)) neighborsOf.set(ti, new Set());
      neighborsOf.get(si).add(ti);
      neighborsOf.get(ti).add(si);
    }

    const n = simNodes.length;
    const hasCache = cachedPositions && cachedPositions.length === n * 3;
    // Semeadura: cache do layout anterior, ou esfera pseudo-aleatória determinística
    for (let i = 0; i < n; i++) {
      if (hasCache) {
        simNodes[i].x = cachedPositions[i * 3];
        simNodes[i].y = cachedPositions[i * 3 + 1];
        simNodes[i].z = cachedPositions[i * 3 + 2];
      } else {
        const a = (i * 2.3999632) % (Math.PI * 2); // golden angle
        const b = Math.acos(1 - 2 * ((i + 0.5) / n));
        const r = 45 + (i % 7) * 4;
        simNodes[i].x = r * Math.sin(b) * Math.cos(a);
        simNodes[i].y = r * Math.sin(b) * Math.sin(a);
        simNodes[i].z = r * Math.cos(b);
      }
    }

    sim = forceSimulation(simNodes, 3)
      .force('charge', forceManyBody().strength(-30).distanceMax(150))
      .force('link', forceLink(simLinks).id(d => d.id).distance(18))
      .force('center', forceCenter(0, 0, 0))
      .force('radial', forceRadial(60, 0, 0, 0).strength(0.06))
      .alphaDecay(0.028)
      .stop();
    if (hasCache) sim.alpha(0); // reentrada — layout já assentado
    settled = hasCache;

    // Points
    const posArr = new Float32Array(n * 3);
    const sizeArr = new Float32Array(n);
    const intArr = new Float32Array(n);
    const seedArr = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const node = simNodes[i];
      sizeArr[i] = node.ghost ? 1.2 : 1.6 + 2.2 * Math.sqrt((node.degree || 0) / maxDegree);
      intArr[i] = baseIntensity(node, maxDegree);
      seedArr[i] = (i * 0.6180339887) % 1 * 10;
    }
    const pGeo = new BufferGeometry();
    pGeo.setAttribute('position', new BufferAttribute(posArr, 3));
    pGeo.setAttribute('aSize', new BufferAttribute(sizeArr, 1));
    pGeo.setAttribute('aIntensity', new BufferAttribute(intArr, 1));
    pGeo.setAttribute('aSeed', new BufferAttribute(seedArr, 1));
    const pMat = new ShaderMaterial({
      uniforms: {
        uColor: { value: new Color(ACCENT) },
        uTime: { value: 0 },
        uHaloCore: { value: TUNING.HALO_CORE },
        uHaloSoftness: { value: TUNING.HALO_SOFTNESS },
      },
      vertexShader: NODE_VERT,
      fragmentShader: NODE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    points = new Points(pGeo, pMat);
    points.frustumCulled = false;
    scene.add(points);

    // Links
    const lPos = new Float32Array(simLinks.length * 6);
    const lCol = new Float32Array(simLinks.length * 6);
    const lGeo = new BufferGeometry();
    lGeo.setAttribute('position', new BufferAttribute(lPos, 3));
    lGeo.setAttribute('color', new BufferAttribute(lCol, 3));
    const lMat = new LineBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false });
    lines = new LineSegments(lGeo, lMat);
    lines.frustumCulled = false;
    scene.add(lines);

    hoveredIndex = -1;
    selectedIndex = -1;
    refreshHighlights();
    syncBuffers(true);
  }

  const accent = new Color(ACCENT);

  function refreshHighlights() {
    if (!points || !lines) return;
    const intAttr = points.geometry.getAttribute('aIntensity');
    const active = selectedIndex >= 0 ? selectedIndex : hoveredIndex;
    const activeNeighbors = active >= 0 ? (neighborsOf.get(active) || new Set()) : null;
    for (let i = 0; i < simNodes.length; i++) {
      let v = baseIntensity(simNodes[i], maxDegree);
      if (active >= 0) {
        if (i === active) v = 1.6;
        else if (activeNeighbors.has(i)) v = Math.min(1.2, v + 0.45);
        else v *= 0.55;
      }
      intAttr.array[i] = v;
    }
    intAttr.needsUpdate = true;

    const idx = new Map(simNodes.map((n, i) => [n.id, i]));
    const colAttr = lines.geometry.getAttribute('color');
    const degK = (i) => {
      const d = simNodes[i]?.degree || 0;
      const t = Math.sqrt(d / Math.max(1, maxDegree)); // sqrt: hubs não estouram
      return TUNING.LINK_GRADIENT_MIN + (TUNING.LINK_GRADIENT_MAX - TUNING.LINK_GRADIENT_MIN) * t;
    };
    for (let li = 0; li < simLinks.length; li++) {
      const l = simLinks[li];
      const si = idx.get(typeof l.source === 'object' ? l.source.id : l.source);
      const ti = idx.get(typeof l.target === 'object' ? l.target.id : l.target);
      const hot = active >= 0 && (si === active || ti === active);
      const ks = hot ? TUNING.LINK_HOT : degK(si);
      const kt = hot ? TUNING.LINK_HOT : degK(ti);
      colAttr.array[li * 6]     = accent.r * ks;
      colAttr.array[li * 6 + 1] = accent.g * ks;
      colAttr.array[li * 6 + 2] = accent.b * ks;
      colAttr.array[li * 6 + 3] = accent.r * kt;
      colAttr.array[li * 6 + 4] = accent.g * kt;
      colAttr.array[li * 6 + 5] = accent.b * kt;
    }
    colAttr.needsUpdate = true;
  }

  function syncBuffers(force) {
    if (!points || !lines) return;
    if (settled && !force) return;
    const posAttr = points.geometry.getAttribute('position');
    for (let i = 0; i < simNodes.length; i++) {
      posAttr.array[i * 3] = simNodes[i].x;
      posAttr.array[i * 3 + 1] = simNodes[i].y;
      posAttr.array[i * 3 + 2] = simNodes[i].z;
    }
    posAttr.needsUpdate = true;

    const lPosAttr = lines.geometry.getAttribute('position');
    for (let li = 0; li < simLinks.length; li++) {
      const s = simLinks[li].source, t = simLinks[li].target;
      lPosAttr.array[li * 6] = s.x; lPosAttr.array[li * 6 + 1] = s.y; lPosAttr.array[li * 6 + 2] = s.z;
      lPosAttr.array[li * 6 + 3] = t.x; lPosAttr.array[li * 6 + 4] = t.y; lPosAttr.array[li * 6 + 5] = t.z;
    }
    lPosAttr.needsUpdate = true;
  }

  function pushOutOfNucleus() {
    const v = new Vector3();
    for (const n of simNodes) {
      v.set(n.x, n.y, n.z);
      const len = v.length();
      if (len < NUCLEUS_RADIUS) {
        v.setLength(len < 0.001 ? NUCLEUS_RADIUS : NUCLEUS_RADIUS);
        n.x = v.x; n.y = v.y; n.z = v.z;
      }
    }
  }

  // ── Interação ─────────────────────────────────────────────────────────
  function updatePointer(e) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    pointerDirty = true;
  }

  function onPointerDown(e) { downPos = { x: e.clientX, y: e.clientY }; }

  function onPointerUp(e) {
    if (!downPos) return;
    const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
    downPos = null;
    if (moved > 5) return; // arrasto do OrbitControls, não é clique
    if (hoveredIndex >= 0 && !simNodes[hoveredIndex].ghost) {
      selectedIndex = hoveredIndex;
      const node = simNodes[selectedIndex];
      focusTarget = new Vector3(node.x, node.y, node.z);
      controls.autoRotate = false;
      refreshHighlights();
      onSelect?.(node);
    } else if (hoveredIndex < 0 && selectedIndex >= 0) {
      clearFocus();
    }
  }

  function screenPos(node) {
    const v = new Vector3(node.x, node.y, node.z).project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    return { x: ((v.x + 1) / 2) * rect.width, y: ((1 - v.y) / 2) * rect.height };
  }

  function doRaycast() {
    if (!points) return;
    raycaster.setFromCamera(pointerNDC, camera);
    const hits = raycaster.intersectObject(points);
    const idx = hits.length ? hits[0].index : -1;
    if (idx !== hoveredIndex) {
      hoveredIndex = idx;
      refreshHighlights();
      if (idx >= 0) {
        const node = simNodes[idx];
        hoverLabel.textContent = node.ghost ? `▸ ${node.title} · não criada` : `▸ ${node.title}`;
        hoverLabel.style.display = 'block';
      } else {
        hoverLabel.style.display = 'none';
      }
    }
  }

  function focusNode(id) {
    const i = simNodes.findIndex(n => n.id === id);
    if (i < 0) return;
    selectedIndex = i;
    const node = simNodes[i];
    focusTarget = new Vector3(node.x, node.y, node.z);
    controls.autoRotate = false;
    refreshHighlights();
  }

  function clearFocus() {
    selectedIndex = -1;
    focusTarget = new Vector3(0, 0, 0);
    controls.autoRotate = !prefersReducedMotion;
    refreshHighlights();
    onSelect?.(null);
  }

  renderer.domElement.addEventListener('pointermove', updatePointer);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointerup', onPointerUp);
  // Usuário pegou a câmera → cancela o tween de foco
  controls.addEventListener('start', () => { focusTarget = null; dollyCancelled = true; });

  const resizeObserver = new ResizeObserver(() => {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
  });
  resizeObserver.observe(container);

  let contextLost = false;
  const onContextLost = (e) => { e.preventDefault(); contextLost = true; opts.onContextLost?.(); };
  const opts = { onContextLost: null };
  renderer.domElement.addEventListener('webglcontextlost', onContextLost);

  // ── Loop ──────────────────────────────────────────────────────────────
  const t0 = performance.now();
  let rippleT = 0;

  function animate() {
    if (disposed || contextLost) return;
    rafId = requestAnimationFrame(animate);
    const t = (performance.now() - t0) / 1000;

    const now = performance.now();
    const frameMs = now - lastFrameStamp;
    lastFrameStamp = now;

    // pixelRatio adaptativo com histerese
    if (!lowRatio && frameMs > TUNING.FRAME_BUDGET_MS) {
      if (++slowFrames > 30) {
        lowRatio = true; slowFrames = 0;
        renderer.setPixelRatio(TUNING.PIXEL_RATIO_LOW);
        composer.setPixelRatio(renderer.getPixelRatio());
      }
    } else if (lowRatio && frameMs < TUNING.FRAME_BUDGET_MS * 0.6) {
      if (++fastFrames > 120) {
        lowRatio = false; fastFrames = 0;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        composer.setPixelRatio(renderer.getPixelRatio());
      }
    } else { slowFrames = 0; fastFrames = 0; }

    // Throttle 30fps em repouso (settled, sem interação/foco/fala/pensamento)
    const idle = settled && hoveredIndex < 0 && !downPos && !focusTarget
      && !pulse.thinking && !pulse.speaking;
    if (idle && now - lastRenderStamp < 1000 / TUNING.IDLE_FPS) return;
    lastRenderStamp = now;

    // Física: budget de 8ms/frame enquanto quente — assentamento orgânico
    if (sim && sim.alpha() > 0.03) {
      const frameStart = performance.now();
      while (sim.alpha() > 0.03 && performance.now() - frameStart < 8) sim.tick();
      syncBuffers();
      if (sim.alpha() <= 0.03) {
        pushOutOfNucleus();
        syncBuffers(true);
        settled = true;
      }
    }

    // Núcleo: respiração / pulso / ondulação — congelado sob reduced-motion
    const mt = prefersReducedMotion ? 0 : t;
    const breathe = prefersReducedMotion ? 1
      : (pulse.thinking ? 1 + 0.10 * Math.sin(t * 9) : 1 + 0.04 * Math.sin(t * 1.2));
    core.scale.setScalar(breathe);
    core.material.uniforms.uFresnelBoost.value =
      TUNING.FRESNEL_BOOST * (pulse.thinking ? 1.4 : pulse.speaking ? 1.15 : 1.0);
    coreInner.scale.setScalar(pulse.thinking ? 1 + 0.15 * Math.sin(mt * 9 + 1) : 1);
    const ringSpeed = pulse.thinking ? 3 : 1;
    rings[0].rotation.z = mt * 0.4 * ringSpeed;
    rings[1].rotation.z = -mt * 0.6 * ringSpeed;
    rings[2].rotation.z = mt * 0.25 * ringSpeed;
    if (pulse.speaking) {
      rippleT = (rippleT + 1 / 72) % 1; // ~1.2s por ciclo a 60fps
      ripple.scale.setScalar(1 + rippleT * 2);
      ripple.material.opacity = 0.5 * (1 - rippleT);
    } else if (ripple.material.opacity > 0) {
      ripple.material.opacity = Math.max(0, ripple.material.opacity - 0.03);
      ripple.scale.setScalar(1 + rippleT * 2);
    }

    if (points) points.material.uniforms.uTime.value = mt;

    // Tween de foco da câmera
    if (focusTarget) {
      controls.target.lerp(focusTarget, 0.06);
      if (selectedIndex >= 0) {
        const dir = camera.position.clone().sub(focusTarget).normalize();
        const desired = focusTarget.clone().add(dir.multiplyScalar(35));
        camera.position.lerp(desired, 0.06);
      }
      if (controls.target.distanceTo(focusTarget) < 0.1) focusTarget = null;
    }

    if (dollyT < 1 && !dollyCancelled && !focusTarget) {
      dollyT = Math.min(1, (performance.now() - dollyStart) / TUNING.DOLLY_MS);
      const e = 1 - Math.pow(1 - dollyT, 3); // ease-out cubic
      const dir = camera.position.clone().sub(controls.target).normalize();
      const r = TUNING.DOLLY_START + (SETTLE_DIST - TUNING.DOLLY_START) * e;
      camera.position.copy(controls.target).add(dir.multiplyScalar(r));
    }

    if (pointerDirty) { pointerDirty = false; doRaycast(); }

    if (hoveredIndex >= 0 && hoverLabel.style.display !== 'none') {
      const sp = screenPos(simNodes[hoveredIndex]);
      hoverLabel.style.left = sp.x + 'px';
      hoverLabel.style.top = sp.y + 'px';
    }

    controls.update();
    composer.render();
  }
  animate();

  function dispose() {
    disposed = true;
    cancelAnimationFrame(rafId);
    renderer.domElement.removeEventListener('pointermove', updatePointer);
    renderer.domElement.removeEventListener('pointerdown', onPointerDown);
    renderer.domElement.removeEventListener('pointerup', onPointerUp);
    renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
    mediaQuery?.removeEventListener?.('change', onReducedMotionChange);
    resizeObserver.disconnect();
    controls.dispose();
    clearGraphObjects();
    scene.traverse(obj => {
      obj.geometry?.dispose?.();
      if (obj.material) (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach(m => m.dispose());
    });
    bloomPass.dispose?.();
    composer.dispose?.();
    renderer.dispose();
    if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
    if (hoverLabel.parentNode === container) container.removeChild(hoverLabel);
  }

  return {
    setGraph,
    setPulse: p => { pulse = { ...pulse, ...p }; },
    focusNode,
    clearFocus,
    getPositions: () => {
      const arr = new Float32Array(simNodes.length * 3);
      simNodes.forEach((n, i) => { arr[i * 3] = n.x; arr[i * 3 + 1] = n.y; arr[i * 3 + 2] = n.z; });
      return arr;
    },
    onContextLost: fn => { opts.onContextLost = fn; },
    dispose,
  };
}
