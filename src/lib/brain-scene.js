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
  varying float vIntensity;
  varying float vSeed;
  void main() {
    float dist = length(gl_PointCoord - vec2(0.5));
    if (dist > 0.5) discard;
    float disc = 1.0 - smoothstep(0.25, 0.5, dist);
    float twinkle = 0.85 + 0.15 * sin(uTime * (1.5 + fract(vSeed) * 2.0) + vSeed * 6.28);
    gl_FragColor = vec4(uColor * vIntensity * twinkle, disc);
  }
`;

function baseIntensity(node, maxDegree) {
  if (node.ghost) return 0.15;
  return 0.35 + 0.65 * Math.sqrt(node.degree / Math.max(1, maxDegree));
}

export function createBrainScene(container, { onHover, onSelect } = {}) {
  const width = container.clientWidth || 800;
  const height = container.clientHeight || 500;

  const scene = new Scene();
  // scene.background (Color gerenciado) em vez de setClearColor — o clear
  // color cru é re-codificado pra sRGB pelo OutputPass e lavaria o preto.
  scene.background = new Color(BG);
  scene.fog = new FogExp2(BG, 0.006);

  const camera = new PerspectiveCamera(55, width / height, 0.1, 1000);
  camera.position.set(0, 25, 140);

  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.3;
  controls.minDistance = 25;
  controls.maxDistance = 320;

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(new Vector2(width, height), 1.2, 0.7, 0.1);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());

  // ── Núcleo arc reactor ────────────────────────────────────────────────
  const nucleus = new Group();
  const core = new Mesh(new SphereGeometry(4.5, 32, 32), new MeshBasicMaterial({ color: ACCENT }));
  const coreInner = new Mesh(new SphereGeometry(1.8, 24, 24), new MeshBasicMaterial({ color: 0xffffff }));
  nucleus.add(core, coreInner);
  const rings = [8, 11, 14].map((r, i) => {
    const ring = new Mesh(
      new TorusGeometry(r, 0.12, 8, 96),
      new MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.5 - i * 0.1 })
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
      uniforms: { uColor: { value: new Color(ACCENT) }, uTime: { value: 0 } },
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
    for (let li = 0; li < simLinks.length; li++) {
      const l = simLinks[li];
      const si = idx.get(typeof l.source === 'object' ? l.source.id : l.source);
      const ti = idx.get(typeof l.target === 'object' ? l.target.id : l.target);
      const hot = active >= 0 && (si === active || ti === active);
      const k = hot ? 0.6 : 0.1;
      colAttr.array[li * 6] = accent.r * k;
      colAttr.array[li * 6 + 1] = accent.g * k;
      colAttr.array[li * 6 + 2] = accent.b * k;
      colAttr.array[li * 6 + 3] = accent.r * k;
      colAttr.array[li * 6 + 4] = accent.g * k;
      colAttr.array[li * 6 + 5] = accent.b * k;
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
        const sp = screenPos(node);
        onHover?.(node, sp.x, sp.y);
      } else {
        onHover?.(null, 0, 0);
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
    controls.autoRotate = true;
    refreshHighlights();
    onSelect?.(null);
  }

  renderer.domElement.addEventListener('pointermove', updatePointer);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointerup', onPointerUp);
  // Usuário pegou a câmera → cancela o tween de foco
  controls.addEventListener('start', () => { focusTarget = null; });

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

    // Núcleo: respiração / pulso de pensamento / ondulação de fala
    const breathe = pulse.thinking ? 1 + 0.10 * Math.sin(t * 9) : 1 + 0.04 * Math.sin(t * 1.2);
    core.scale.setScalar(breathe);
    coreInner.scale.setScalar(pulse.thinking ? 1 + 0.15 * Math.sin(t * 9 + 1) : 1);
    const ringSpeed = pulse.thinking ? 3 : 1;
    rings[0].rotation.z = t * 0.4 * ringSpeed;
    rings[1].rotation.z = -t * 0.6 * ringSpeed;
    rings[2].rotation.z = t * 0.25 * ringSpeed;
    if (pulse.speaking) {
      rippleT = (rippleT + 1 / 72) % 1; // ~1.2s por ciclo a 60fps
      ripple.scale.setScalar(1 + rippleT * 2);
      ripple.material.opacity = 0.5 * (1 - rippleT);
    } else if (ripple.material.opacity > 0) {
      ripple.material.opacity = Math.max(0, ripple.material.opacity - 0.03);
      ripple.scale.setScalar(1 + rippleT * 2);
    }

    if (points) points.material.uniforms.uTime.value = t;

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

    if (pointerDirty) { pointerDirty = false; doRaycast(); }

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
