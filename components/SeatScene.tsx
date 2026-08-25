'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import {
  BLOOM_LAYER,
  createSeatGeometry,
  createSeatObject,
  disposeSeatGeometry,
  paintSeat,
  SEAT_EYE,
  type SeatObject3D,
  type SeatTokens,
  type SeatVisualState,
} from '@/lib/seat-object';
import {
  RESET_EVENT,
  SEATS_EVENT,
  STRESS_EVENT,
  type SeatsDetail,
  type StressDetail,
} from '@/lib/demo-events';

export type Seat = {
  id: string;
  label: string;
  status: 'open' | 'claimed';
};

type SeatEntry = {
  data: Seat;
  state: SeatVisualState;
  object: SeatObject3D;
  home: THREE.Vector3;
  /** Scroll progress at which this seat starts fading in. 0 for the hero. */
  revealAt: number;
  reveal: number; // eased 0..1
  hover: number; // eased 0..1
  flash: number; // seconds left on a rejection flash
  shake: number; // seconds left on a shake
  busy: boolean;
};

// ── Layout ────────────────────────────────────────────────────────────────
// Seats stand on a floor and face +Z, so the camera looks at their fronts.
const COLS = 3;
const COL_SPACING = 2.55;
const ROW_SPACING = 3.1;

const HERO_X = -COL_SPACING;
const HERO_Z = ROW_SPACING / 2;

/**
 * Camera waypoints — one composed shot each, per the scroll-camera skill.
 *
 * 0  the hero seat, close and near eye level
 * 1  lifting away as the rest of the row appears
 * 2  the pull-back continues
 * 3  the real grid framing, where the seats become clickable
 *
 * `fov` is the VERTICAL field of view at the reference aspect below; the real
 * fov is re-derived every frame so the horizontal framing survives a phone.
 * `pan` pushes the subject off the optical axis, as a fraction of the visible
 * half-frame, to leave the story text its own side of the screen.
 */
const REF_ASPECT = 16 / 9;
const MAX_VFOV = 68; // degrees; past this a portrait screen starts to distort

const CAM = [
  {
    p: [HERO_X + 3.1, 2.3, HERO_Z + 5.1],
    t: [HERO_X + 0.15, 0.72, HERO_Z - 0.1],
    fov: 34,
    pan: 0.38,
  },
  { p: [-2.0, 3.6, 8.6], t: [-2.0, 0.68, 1.0], fov: 34, pan: 0.32 },
  { p: [-1.0, 4.4, 9.4], t: [-1.0, 0.6, 0.3], fov: 33, pan: 0.15 },
  { p: [0, 5.6, 11.5], t: [0, 0.5, -0.3], fov: 33, pan: 0 },
] as const;

const N = CAM.length - 1;

/** Progress past which the grid is live and the canvas takes clicks. */
const INTERACTIVE_FROM = N - 0.5;

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** Additively blends the bloom-only render back over the full-scene render. */
const MIX_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const MIX_FRAG = `
uniform sampler2D baseTexture;
uniform sampler2D bloomTexture;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(baseTexture, vUv) + texture2D(bloomTexture, vUv);
}
`;

export default function SeatScene({ seats }: { seats: Seat[] }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    const scrim = scrimRef.current;
    if (!mount || !scrim) return;

    // ── Tokens ─────────────────────────────────────────────────────────────
    // Every colour and motion constant comes from design-tokens.css. None is
    // written here, so editing the stylesheet edits the scene.
    const css = getComputedStyle(document.documentElement);
    const token = (name: string) => css.getPropertyValue(name).trim();
    const color = (name: string) => new THREE.Color(token(name));

    const tokens: SeatTokens = {
      surface: color('--bg-2'),
      base: color('--bg'),
      ink: color('--ink'),
      inkDim: color('--ink-dim'),
      accent: color('--accent'),
    };
    const FOG = color('--fog');
    const CAM_DAMP = parseFloat(token('--cam-damp')) || 5;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ── Renderer ───────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    // Capped below 2: the bloom chain is fill-rate bound, and a retina panel
    // would quadruple its cost for no visible gain on a blurred pass.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    // Applied by OutputPass at the end of the chain. While rendering into the
    // composer's half-float targets three keeps everything linear, which is
    // what lets an emissive above 1.0 survive as far as the bloom pass.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = tokens.base;
    scene.fog = new THREE.Fog(FOG, 14, 42);

    const camera = new THREE.PerspectiveCamera(
      CAM[0].fov,
      mount.clientWidth / mount.clientHeight,
      0.1,
      120,
    );

    // ── Lighting ───────────────────────────────────────────────────────────
    // Dark, directional and shaped: a key spot from front-right, a bone-white
    // backlight that draws the silhouette's edge, and a cool accent rim on the
    // other side. Without the two rims the seats read as flat cut-outs against
    // the near-black background.
    scene.add(new THREE.AmbientLight(tokens.inkDim, 0.45));

    // decay 0 on both spots: these are lighting instruments aimed at a set,
    // not bulbs in a room. With inverse-square falloff the same rig that reads
    // on the close hero shot collapses to black by the time the camera has
    // pulled back to the grid, and the shot would have to be relit twice.
    const KEY_INTENSITY = 3.4;
    const key = new THREE.SpotLight(tokens.ink, KEY_INTENSITY, 0, 0.95, 0.9, 0);
    key.position.set(6.5, 9, 7.5);
    key.target.position.set(0, SEAT_EYE, 0);
    scene.add(key, key.target);

    // A second, tighter spot that exists only for the opening shot. It fades
    // out as the camera pulls back, so the hero is dramatically lit up close
    // without leaving one seat blown out in the final grid.
    const HERO_KEY_INTENSITY = 2.2;
    const heroKey = new THREE.SpotLight(tokens.ink, HERO_KEY_INTENSITY, 0, 0.5, 0.8, 0);
    heroKey.position.set(HERO_X + 2.4, 3.4, HERO_Z + 2.8);
    heroKey.target.position.set(HERO_X, SEAT_EYE, HERO_Z);
    scene.add(heroKey, heroKey.target);

    // The two rims are the reason the seats have an edge at all. Without them
    // a near-black body against a near-black background is a silhouette.
    const rim = new THREE.DirectionalLight(tokens.ink, 3.2);
    rim.position.set(-7, 2.4, -8);
    scene.add(rim);

    const accentRim = new THREE.DirectionalLight(tokens.accent, 1.4);
    accentRim.position.set(6.5, 1.2, -7);
    scene.add(accentRim);

    // A weak frontal fill. The two rims draw the edges but leave the faces
    // that point at the camera unlit, which flattens the object back out;
    // this is just enough to keep the cushion and the back panel reading as
    // separate planes without lifting the scene out of the dark.
    const fill = new THREE.DirectionalLight(tokens.inkDim, 0.85);
    fill.position.set(-1.5, 2.5, 10);
    scene.add(fill);

    // ── Seats ──────────────────────────────────────────────────────────────
    const geometry = createSeatGeometry();

    const rowKeys = [...new Set(seats.map((s) => s.label[0]))].sort();
    const homeOf = (seat: Seat, index: number) => {
      const rowIndex = rowKeys.indexOf(seat.label[0]);
      const colIndex = Number(seat.label.slice(1)) - 1;
      const row = rowIndex >= 0 ? rowIndex : Math.floor(index / COLS);
      const col = Number.isFinite(colIndex) && colIndex >= 0 ? colIndex : index % COLS;
      const rows = Math.max(rowKeys.length, 1);
      return new THREE.Vector3(
        (col - (COLS - 1) / 2) * COL_SPACING,
        0,
        ((rows - 1) / 2 - row) * ROW_SPACING,
      );
    };

    const entries: SeatEntry[] = seats.map((seat, index) => {
      const object = createSeatObject(geometry, tokens);
      const at = homeOf(seat, index);
      object.group.position.copy(at);
      scene.add(object.group);
      return {
        data: seat,
        state: seat.status === 'claimed' ? 'claimed' : 'open',
        object,
        home: at,
        revealAt: 0,
        reveal: 0,
        hover: 0,
        flash: 0,
        shake: 0,
        busy: false,
      };
    });

    // The hero is the first seat by label — the one the opening shot frames.
    // The rest fade in outward from it as the camera retreats, so the grid
    // assembles itself rather than cutting in.
    const hero = entries[0] ?? null;
    if (hero) hero.reveal = 1;
    if (hero) {
      entries
        .slice(1)
        .sort((a, b) => a.home.distanceTo(hero.home) - b.home.distanceTo(hero.home))
        .forEach((entry, i) => {
          entry.revealAt = 0.55 + i * 0.34;
        });
    }

    const meshToSeat = new Map<THREE.Object3D, SeatEntry>();
    for (const entry of entries) {
      paintSeat(entry.object, entry.state, tokens);
      for (const mesh of entry.object.meshes) meshToSeat.set(mesh, entry);
    }
    const pickTargets = entries.flatMap((entry) => entry.object.meshes);
    const seatById = new Map(entries.map((entry) => [entry.data.id, entry]));

    /**
     * Tell the HUD the current tally. The scene is the only thing that knows
     * a seat's live state — every path that changes one calls this, so the
     * counts can never drift from what is actually on screen.
     */
    const publishCounts = () => {
      const claimed = entries.reduce((n, entry) => n + (entry.state === 'open' ? 0 : 1), 0);
      const detail: SeatsDetail = { open: entries.length - claimed, claimed };
      window.dispatchEvent(new CustomEvent(SEATS_EVENT, { detail }));
    };

    // ── Post-processing: selective bloom ───────────────────────────────────
    // Two chains. The first renders the scene with every non-emitting mesh
    // swapped for flat black, so only the inset indicators and the claim
    // particles survive into UnrealBloomPass. The second renders the scene
    // normally and adds that bloom back on top. This is why the glow sits on
    // the light and not on the whole object — a single full-scene bloom would
    // smear the seat bodies and the fog along with it.
    const BLOOM_SCALE = 0.5; // the bloom chain runs at half resolution
    const bloomLayer = new THREE.Layers();
    bloomLayer.set(BLOOM_LAYER);

    const dark = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const stashed = new Map<string, THREE.Material | THREE.Material[]>();

    const darken = (object: THREE.Object3D) => {
      const renderable = object as THREE.Mesh | THREE.Points;
      if (!('material' in renderable) || !renderable.material) return;
      if (bloomLayer.test(object.layers)) return;
      stashed.set(object.uuid, renderable.material);
      renderable.material = dark;
    };

    const restore = (object: THREE.Object3D) => {
      const saved = stashed.get(object.uuid);
      if (!saved) return;
      (object as THREE.Mesh).material = saved;
      stashed.delete(object.uuid);
    };

    const width = mount.clientWidth;
    const height = mount.clientHeight;

    const bloomComposer = new EffectComposer(renderer);
    bloomComposer.renderToScreen = false;
    bloomComposer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width * BLOOM_SCALE, height * BLOOM_SCALE),
      0.45, // strength — restrained; this is edge light, not a haze
      0.5, // radius
      0, // threshold: the chain already contains nothing but lit elements
    );
    bloomComposer.addPass(bloomPass);
    bloomComposer.setSize(width * BLOOM_SCALE, height * BLOOM_SCALE);

    const mixPass = new ShaderPass(
      new THREE.ShaderMaterial({
        uniforms: {
          baseTexture: { value: null },
          bloomTexture: { value: bloomComposer.renderTarget2.texture },
        },
        vertexShader: MIX_VERT,
        fragmentShader: MIX_FRAG,
        depthTest: false,
      }),
      'baseTexture',
    );
    mixPass.needsSwap = true;

    const finalComposer = new EffectComposer(renderer);
    finalComposer.addPass(new RenderPass(scene, camera));
    finalComposer.addPass(mixPass);
    finalComposer.addPass(new OutputPass());

    // ── Camera spline ──────────────────────────────────────────────────────
    const curveP = new THREE.CatmullRomCurve3(
      CAM.map((w) => new THREE.Vector3(w.p[0], w.p[1], w.p[2])),
      false,
      'catmullrom',
      0.4,
    );
    const curveT = new THREE.CatmullRomCurve3(
      CAM.map((w) => new THREE.Vector3(w.t[0], w.t[1], w.t[2])),
      false,
      'catmullrom',
      0.4,
    );

    let maxScroll = 1;
    const measure = () => {
      maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    };
    measure();

    // The listener does nothing but record; the rAF loop reads it. Passive, so
    // it can never delay a scroll.
    let scrollY = window.scrollY;
    const onScroll = () => {
      scrollY = window.scrollY;
    };
    window.addEventListener('scroll', onScroll, { passive: true });

    // Mouse parallax, faded down once the intro is over.
    const parallax = new THREE.Vector2();
    const parallaxTarget = new THREE.Vector2();
    const onMouse = (event: MouseEvent) => {
      parallaxTarget.set(
        (event.clientX / window.innerWidth) * 2 - 1,
        (event.clientY / window.innerHeight) * 2 - 1,
      );
    };
    if (!reducedMotion) window.addEventListener('mousemove', onMouse, { passive: true });

    // ── Claim particles ────────────────────────────────────────────────────
    type Burst = {
      points: THREE.Points;
      velocities: Float32Array;
      life: number;
      maxLife: number;
      material: THREE.PointsMaterial;
      geometry: THREE.BufferGeometry;
    };
    const bursts: Burst[] = [];

    const spawnBurst = (at: THREE.Vector3) => {
      const count = reducedMotion ? 24 : 140;
      const positions = new Float32Array(count * 3);
      const velocities = new Float32Array(count * 3);

      for (let i = 0; i < count; i++) {
        positions[i * 3] = at.x;
        positions[i * 3 + 1] = at.y + SEAT_EYE;
        positions[i * 3 + 2] = at.z;

        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const speed = 1.6 + Math.random() * 2.6;
        velocities[i * 3] = Math.sin(phi) * Math.cos(theta) * speed;
        velocities[i * 3 + 1] = Math.sin(phi) * Math.sin(theta) * speed;
        velocities[i * 3 + 2] = Math.cos(phi) * speed * 0.55 + 0.7;
      }

      const burstGeometry = new THREE.BufferGeometry();
      burstGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const material = new THREE.PointsMaterial({
        color: tokens.accent,
        size: 0.07,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const points = new THREE.Points(burstGeometry, material);
      points.layers.enable(BLOOM_LAYER); // the burst is light, so it blooms
      scene.add(points);

      const maxLife = reducedMotion ? 0.5 : 1.15;
      bursts.push({
        points,
        velocities,
        life: maxLife,
        maxLife,
        material,
        geometry: burstGeometry,
      });
    };

    // ── Stress-test swarm ──────────────────────────────────────────────────
    // The brief's picture of the race: N claims converge on one seat, one
    // lands and lights it, the rest deflect. Every number driving this comes
    // back from the server AFTER the real run has finished — the animation
    // reports a result, it never predicts one.
    type Swarm = {
      points: THREE.Points;
      geometry: THREE.BufferGeometry;
      material: THREE.PointsMaterial;
      origins: Float32Array;
      velocities: Float32Array;
      colors: Float32Array;
      target: THREE.Vector3;
      count: number;
      /** Index of the particle that lands. -1 when the server reported no winner. */
      winner: number;
      entry: SeatEntry;
      t: number;
      landed: boolean;
    };
    const swarms: Swarm[] = [];

    const INBOUND = 0.85; // seconds of convergence
    const OUTBOUND = 0.9; // seconds of deflection afterwards

    const spawnSwarm = (entry: SeatEntry, total: number, winners: number) => {
      const count = Math.min(total, 80);
      const target = entry.home.clone().setY(SEAT_EYE);

      const positions = new Float32Array(count * 3);
      const origins = new Float32Array(count * 3);
      const velocities = new Float32Array(count * 3);
      const colors = new Float32Array(count * 3);

      // The winner is a real index so the landing reads as one of the crowd
      // arriving, not a separate effect played on top of it.
      const winner = winners > 0 ? Math.floor(Math.random() * count) : -1;

      for (let i = 0; i < count; i++) {
        // A shell around the seat, flattened in Y so the swarm reads against
        // the grid rather than as a ball.
        const theta = (i / count) * Math.PI * 2 + Math.random() * 0.4;
        const radius = 4.2 + Math.random() * 2.6;
        const height = (Math.random() - 0.5) * 2.4;

        origins[i * 3] = target.x + Math.cos(theta) * radius;
        origins[i * 3 + 1] = target.y + height;
        origins[i * 3 + 2] = target.z + Math.sin(theta) * radius * 0.75;

        positions[i * 3] = origins[i * 3];
        positions[i * 3 + 1] = origins[i * 3 + 1];
        positions[i * 3 + 2] = origins[i * 3 + 2];

        // Colour carries the verdict: the one that lands is the accent, the
        // rest die cold. Reserving the accent for the seat that is actually
        // won is the same rule the seat materials follow.
        const tint = i === winner ? tokens.accent : tokens.inkDim;
        colors[i * 3] = tint.r;
        colors[i * 3 + 1] = tint.g;
        colors[i * 3 + 2] = tint.b;
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

      const material = new THREE.PointsMaterial({
        size: 0.075,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });

      const points = new THREE.Points(geometry, material);
      points.layers.enable(BLOOM_LAYER); // the swarm is light, so it blooms
      scene.add(points);

      swarms.push({
        points,
        geometry,
        material,
        origins,
        velocities,
        colors,
        target,
        count,
        winner,
        entry,
        t: 0,
        landed: false,
      });
    };

    // ── Interaction ────────────────────────────────────────────────────────
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let hovered: SeatEntry | null = null;
    let interactive = false;

    const updatePointer = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    };

    const pick = (): SeatEntry | null => {
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(pickTargets, false)[0];
      return hit ? meshToSeat.get(hit.object) ?? null : null;
    };

    const onPointerMove = (event: PointerEvent) => {
      updatePointer(event);
      hovered = pick();
      renderer.domElement.style.cursor =
        hovered && hovered.state === 'open' && !hovered.busy ? 'pointer' : 'default';
    };

    /**
     * Claim a seat. Nothing about the seat changes until the server answers —
     * no optimistic state, no early particles.
     */
    const claim = async (entry: SeatEntry) => {
      if (entry.busy || entry.state !== 'open') return;
      entry.busy = true;

      try {
        const response = await fetch(`/api/seats/${entry.data.id}/claim`, {
          method: 'POST',
          credentials: 'same-origin', // carry the session cookie
        });

        if (response.status === 200) {
          entry.state = 'mine';
          paintSeat(entry.object, entry.state, tokens);
          spawnBurst(entry.home);
          publishCounts();
        } else if (response.status === 409) {
          // Someone else holds it. The server just told us the truth about a
          // seat we believed was open, so correct the view.
          entry.state = 'claimed';
          paintSeat(entry.object, entry.state, tokens);
          entry.shake = 0.42;
          publishCounts();
        } else {
          // 403 cap reached, 429 rate limited, 4xx/5xx otherwise. The seat is
          // still open — only the caller was refused.
          entry.flash = 0.55;
        }
      } catch {
        entry.flash = 0.55; // network failure: refuse silently, change nothing
      } finally {
        entry.busy = false;
      }
    };

    const onClick = (event: PointerEvent) => {
      if (!interactive) return;
      updatePointer(event);
      const entry = pick();
      if (entry) void claim(entry);
    };

    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('click', onClick as EventListener);

    // ── HUD bridge ─────────────────────────────────────────────────────────
    const onStress = (event: Event) => {
      const detail = (event as CustomEvent<StressDetail>).detail;
      const entry = seatById.get(detail.seatId);
      if (!entry) return;

      // The server has already decided. Apply that NOW, before any animation:
      // the seat's appearance is supposed to BE its real state, so it must not
      // wait on frames that may never arrive. A backgrounded tab gets no
      // requestAnimationFrame at all, and an earlier version of this hung the
      // state change off the particles landing — which left a seat the server
      // had confirmed as taken still showing as open, indefinitely.
      if (detail.winners > 0) {
        // The winner is one of fifty strangers, not this browser, so the seat
        // settles into `claimed` rather than `mine` — which is the truth.
        entry.state = 'claimed';
        paintSeat(entry.object, entry.state, tokens);
      }
      publishCounts();

      // The swarm is now purely how the result is narrated. If it never runs,
      // nothing about what the page is claiming changes.
      if (reducedMotion) return;
      spawnSwarm(entry, detail.winners + detail.rejected, detail.winners);
    };

    const onReset = () => {
      for (const entry of entries) {
        entry.state = 'open';
        entry.flash = 0;
        entry.shake = 0;
        paintSeat(entry.object, entry.state, tokens);
      }
      publishCounts();
    };

    window.addEventListener(STRESS_EVENT, onStress);
    window.addEventListener(RESET_EVENT, onReset);
    publishCounts(); // seed the HUD from the scene's own state

    // ── Loop ───────────────────────────────────────────────────────────────
    const started = performance.now();
    let last = started;
    let frame = 0;
    // Seeded from where the page already is, not from zero: reloading halfway
    // down — or restoring a scroll position — must open on the shot that
    // belongs to that scroll offset, not replay the whole move to catch up.
    let smooth = Math.min(1, Math.max(0, scrollY / maxScroll)) * N;
    let scrimShown = -1;

    const _p = new THREE.Vector3();
    const _t = new THREE.Vector3();
    const _forward = new THREE.Vector3();
    const _right = new THREE.Vector3();
    const _up = new THREE.Vector3();
    const UP = new THREE.Vector3(0, 1, 0);
    const scratch = new THREE.Color();

    const tick = () => {
      frame = requestAnimationFrame(tick);
      const now = performance.now();
      // Clamped so a backgrounded tab cannot resume with a huge step.
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const time = (now - started) / 1000;

      // 1. Scroll to progress in [0, N], then ease toward it frame-rate
      //    independently. Never off frame count.
      const progress = Math.min(1, Math.max(0, scrollY / maxScroll)) * N;
      const rate = reducedMotion ? CAM_DAMP * 4 : CAM_DAMP;
      smooth += (progress - smooth) * (1 - Math.exp(-rate * dt));

      const u = smooth / N;
      const i = Math.min(N - 1, Math.floor(smooth));
      const f = smooth - i;

      curveP.getPoint(u, _p);
      curveT.getPoint(u, _t); // the sampled target, not a raw waypoint

      const fovRef = THREE.MathUtils.lerp(CAM[i].fov, CAM[i + 1].fov, f);
      const panAmount = THREE.MathUtils.lerp(CAM[i].pan, CAM[i + 1].pan, f);

      // 2. Responsive framing. The waypoint fov describes the shot at 16:9; on
      //    a narrower screen the vertical fov widens to hold the same
      //    horizontal framing, and once that would start to distort, the
      //    camera dollies back for the remainder instead.
      //
      //    Verifying this at ~390x844: Chrome's window-resize automation is
      //    ignored when the OS window is snapped/maximised, so the viewport
      //    never actually changes and the check silently passes against a
      //    desktop frame. Load the page in a same-origin iframe sized
      //    390x844 instead — a temporary page under public/ works — because
      //    an iframe is a real viewport: matchMedia, the CSS media queries
      //    and mount.clientWidth/Height all resolve against it, so this
      //    branch and the portrait scrim are genuinely exercised. Note the
      //    scene pauses on visibilitychange, so keep the tab focused and give
      //    the camera a second to ease before judging a frame.
      const hHalfTan = Math.tan(THREE.MathUtils.degToRad(fovRef) / 2) * REF_ASPECT;
      const needTan = hHalfTan / camera.aspect;
      const haveTan = Math.min(needTan, Math.tan(THREE.MathUtils.degToRad(MAX_VFOV) / 2));
      const dolly = needTan / haveTan;
      const fov = THREE.MathUtils.radToDeg(Math.atan(haveTan)) * 2;
      if (Math.abs(camera.fov - fov) > 0.01) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }

      _p.sub(_t).multiplyScalar(dolly).add(_t);

      // 3. Autonomous drift. Zero while the reader is scrolling the story so
      //    it cannot fight the scroll; it eases in only once the grid shot has
      //    arrived, which is the ambient orbit the brief asks for.
      if (!reducedMotion) {
        const idle = smoothstep(N - 1, N, smooth);
        _p.x += Math.sin(time * 0.16) * 0.55 * idle;
        _p.y += Math.sin(time * 0.11 + 1.3) * 0.28 * idle;
        _p.z += Math.sin(time * 0.09) * 0.4 * idle;
      }

      // 4. Screen-space pan, so the opening shot sits clear of the story text.
      //    Shifting camera and target together along the camera's own right /
      //    up axis slides the subject across the frame without re-aiming it.
      _forward.copy(_t).sub(_p);
      const distance = _forward.length() || 1;
      _forward.divideScalar(distance);
      _right.crossVectors(_forward, UP).normalize();
      _up.crossVectors(_right, _forward).normalize();

      if (panAmount > 0.001) {
        if (camera.aspect < 1.05) {
          // Portrait has no room beside the text, so the subject drops below
          // it instead of moving aside.
          const shift = panAmount * 0.95 * haveTan * distance;
          _p.addScaledVector(_up, shift);
          _t.addScaledVector(_up, shift);
        } else {
          const shift = panAmount * haveTan * camera.aspect * distance;
          _p.addScaledVector(_right, -shift);
          _t.addScaledVector(_right, -shift);
        }
      }

      // 5. Mouse parallax on top, fading out as the grid arrives.
      if (!reducedMotion) {
        parallax.lerp(parallaxTarget, 1 - Math.exp(-3 * dt));
        const weight = 0.28 * (1 - 0.6 * u);
        _p.addScaledVector(_right, parallax.x * weight);
        _p.addScaledVector(_up, -parallax.y * weight * 0.7);
      }

      camera.position.copy(_p);
      camera.lookAt(_t);

      // The opening key light belongs to the opening shot only.
      heroKey.intensity = HERO_KEY_INTENSITY * (1 - smoothstep(0, 1.4, smooth));

      // 6. Scrim over the canvas, so the story copy keeps its contrast while
      //    the scene runs behind it. Written only when it actually moves.
      const scrimWanted = 1 - smoothstep(N - 1.3, N - 0.15, smooth);
      if (Math.abs(scrimWanted - scrimShown) > 0.01) {
        scrimShown = scrimWanted;
        scrim.style.opacity = scrimWanted.toFixed(2);
      }

      // 7. The grid only accepts clicks once it is actually the grid.
      const wantInteractive = smooth > INTERACTIVE_FROM;
      if (wantInteractive !== interactive) {
        interactive = wantInteractive;
        renderer.domElement.style.pointerEvents = interactive ? 'auto' : 'none';
        if (!interactive) hovered = null;
      }

      // ── Seats ────────────────────────────────────────────────────────────
      for (const entry of entries) {
        const wantReveal =
          entry === hero ? 1 : smoothstep(entry.revealAt, entry.revealAt + 0.75, smooth);
        entry.reveal += (wantReveal - entry.reveal) * (1 - Math.exp(-8 * dt));

        const wantHover =
          interactive && entry === hovered && entry.state === 'open' && !entry.busy ? 1 : 0;
        entry.hover += (wantHover - entry.hover) * (1 - Math.exp(-12 * dt));

        let x = entry.home.x;
        if (entry.shake > 0) {
          entry.shake = Math.max(0, entry.shake - dt);
          x += Math.sin(entry.shake * 70) * entry.shake * 0.16;
        }

        const group = entry.object.group;
        group.position.set(x, entry.home.y, entry.home.z + entry.hover * 0.3);
        group.rotation.y = entry.hover * 0.1;
        group.scale.setScalar(0.9 + entry.reveal * 0.1);
        group.visible = entry.reveal > 0.004;

        entry.object.body.opacity = entry.reveal;
        entry.object.accent.opacity = entry.reveal;

        const accent = entry.object.accent;
        if (entry.flash > 0) {
          entry.flash = Math.max(0, entry.flash - dt);
          // A refusal reads as the indicator pulsing without the seat changing
          // state — it stays open, the caller was simply refused.
          accent.emissive.copy(tokens.accent);
          accent.emissiveIntensity =
            (0.4 + Math.sin(entry.flash * 30) * 2.2 * entry.flash) * entry.reveal;
          if (entry.flash === 0) paintSeat(entry.object, entry.state, tokens);
        } else if (entry.state === 'open') {
          accent.emissive.copy(scratch.copy(tokens.inkDim).lerp(tokens.ink, entry.hover));
          accent.emissiveIntensity = (0.26 + entry.hover * 1.1) * entry.reveal;
        } else if (entry.state === 'mine') {
          accent.emissiveIntensity = (2.6 + Math.sin(time * 1.6) * 0.25) * entry.reveal;
        } else {
          accent.emissiveIntensity = 0.05 * entry.reveal;
        }
      }

      // ── Bursts ───────────────────────────────────────────────────────────
      for (let b = bursts.length - 1; b >= 0; b--) {
        const burst = bursts[b];
        burst.life -= dt;
        if (burst.life <= 0) {
          scene.remove(burst.points);
          burst.geometry.dispose();
          burst.material.dispose();
          bursts.splice(b, 1);
          continue;
        }
        const attribute = burst.geometry.getAttribute('position') as THREE.BufferAttribute;
        const array = attribute.array as Float32Array;
        for (let q = 0; q < array.length; q += 3) {
          array[q] += burst.velocities[q] * dt;
          array[q + 1] += burst.velocities[q + 1] * dt;
          array[q + 2] += burst.velocities[q + 2] * dt;
          burst.velocities[q + 1] -= 3.2 * dt; // gravity
        }
        attribute.needsUpdate = true;
        burst.material.opacity = burst.life / burst.maxLife;
      }

      // ── Swarm ────────────────────────────────────────────────────────────
      for (let w = swarms.length - 1; w >= 0; w--) {
        const swarm = swarms[w];
        swarm.t += dt;

        const attribute = swarm.geometry.getAttribute('position') as THREE.BufferAttribute;
        const array = attribute.array as Float32Array;
        const tint = swarm.geometry.getAttribute('color') as THREE.BufferAttribute;
        const tints = tint.array as Float32Array;

        if (swarm.t < INBOUND) {
          // Converge. Accelerating inward reads as being pulled in rather
          // than drifting.
          const k = swarm.t / INBOUND;
          const ease = k * k;
          for (let i = 0; i < swarm.count; i++) {
            const p = i * 3;
            array[p] = swarm.origins[p] + (swarm.target.x - swarm.origins[p]) * ease;
            array[p + 1] = swarm.origins[p + 1] + (swarm.target.y - swarm.origins[p + 1]) * ease;
            array[p + 2] = swarm.origins[p + 2] + (swarm.target.z - swarm.origins[p + 2]) * ease;
          }
          swarm.material.opacity = Math.min(1, swarm.t / 0.18);
        } else {
          if (!swarm.landed) {
            swarm.landed = true;

            // The moment of arrival — punctuation only. The seat already
            // carries the state the server reported; this is the flash and
            // the burst that say which one of the fifty got there.
            if (swarm.winner >= 0) {
              swarm.entry.flash = 0.5;
              spawnBurst(swarm.entry.home);
            } else {
              swarm.entry.shake = 0.42;
            }

            for (let i = 0; i < swarm.count; i++) {
              const p = i * 3;
              if (i === swarm.winner) {
                // It landed — it does not come back out.
                tints[p] = tints[p + 1] = tints[p + 2] = 0;
                continue;
              }
              // Deflect back out along the way it came in, with some spread.
              const dx = swarm.origins[p] - swarm.target.x;
              const dy = swarm.origins[p + 1] - swarm.target.y;
              const dz = swarm.origins[p + 2] - swarm.target.z;
              const length = Math.hypot(dx, dy, dz) || 1;
              const speed = 2.6 + Math.random() * 2.2;
              swarm.velocities[p] = (dx / length) * speed;
              swarm.velocities[p + 1] = (dy / length) * speed + 0.8;
              swarm.velocities[p + 2] = (dz / length) * speed;
            }
          }

          const out = (swarm.t - INBOUND) / OUTBOUND;
          for (let i = 0; i < swarm.count; i++) {
            const p = i * 3;
            array[p] += swarm.velocities[p] * dt;
            array[p + 1] += swarm.velocities[p + 1] * dt;
            array[p + 2] += swarm.velocities[p + 2] * dt;
            swarm.velocities[p + 1] -= 3.2 * dt; // gravity
          }
          // Additive blending, so dimming the colour IS the fade — and the
          // one that landed is already black, so it simply is not there.
          const fade = Math.max(0, 1 - out);
          for (let i = 0; i < swarm.count; i++) {
            const p = i * 3;
            if (i === swarm.winner) continue;
            tints[p] = swarm.colors[p] * fade;
            tints[p + 1] = swarm.colors[p + 1] * fade;
            tints[p + 2] = swarm.colors[p + 2] * fade;
          }
          tint.needsUpdate = true;

          if (swarm.t >= INBOUND + OUTBOUND) {
            scene.remove(swarm.points);
            swarm.geometry.dispose();
            swarm.material.dispose();
            swarms.splice(w, 1);
            continue;
          }
        }
        attribute.needsUpdate = true;
      }

      // ── Render: the bloom chain, then the scene with the bloom added back ─
      const background = scene.background;
      const fog = scene.fog;
      scene.background = null; // the bloom chain must start from true black
      scene.fog = null;
      scene.traverse(darken);
      bloomComposer.render();
      scene.traverse(restore);
      scene.background = background;
      scene.fog = fog;

      finalComposer.render();
    };

    // ── Run only while the tab is visible ──────────────────────────────────
    let running = false;
    const start = () => {
      if (running) return;
      running = true;
      last = performance.now(); // no huge dt after a pause
      frame = requestAnimationFrame(tick);
    };
    const stop = () => {
      if (!running) return;
      running = false;
      cancelAnimationFrame(frame);
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVisibility);
    start();

    // ── Resize ─────────────────────────────────────────────────────────────
    const onResize = () => {
      if (!mount.clientWidth || !mount.clientHeight) return;
      measure();
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      finalComposer.setSize(mount.clientWidth, mount.clientHeight);
      bloomComposer.setSize(mount.clientWidth * BLOOM_SCALE, mount.clientHeight * BLOOM_SCALE);
      mixPass.uniforms.bloomTexture.value = bloomComposer.renderTarget2.texture;
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(mount);
    // The page can grow without the canvas changing size (story text rewrapping
    // on a rotate), and maxScroll has to follow it.
    const bodyObserver = new ResizeObserver(measure);
    bodyObserver.observe(document.body);

    // ── Teardown ───────────────────────────────────────────────────────────
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('mousemove', onMouse);
      window.removeEventListener(STRESS_EVENT, onStress);
      window.removeEventListener(RESET_EVENT, onReset);
      observer.disconnect();
      bodyObserver.disconnect();
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('click', onClick as EventListener);
      for (const entry of entries) {
        entry.object.body.dispose();
        entry.object.accent.dispose();
      }
      for (const burst of bursts) {
        burst.geometry.dispose();
        burst.material.dispose();
      }
      for (const swarm of swarms) {
        swarm.geometry.dispose();
        swarm.material.dispose();
      }
      disposeSeatGeometry(geometry);
      dark.dispose();
      bloomPass.dispose();
      bloomComposer.dispose();
      finalComposer.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [seats]);

  return (
    <div className="pointer-events-none fixed inset-0 z-0" aria-hidden="true">
      <div ref={mountRef} className="absolute inset-0" />
      <div ref={scrimRef} className="scene-scrim absolute inset-0" />
    </div>
  );
}
