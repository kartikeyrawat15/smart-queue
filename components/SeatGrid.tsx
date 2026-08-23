'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

export type Seat = {
  id: string;
  label: string;
  status: 'open' | 'claimed';
};

/**
 * Runtime state of one seat.
 *
 * `claimed` means someone holds it; `mine` means this session's claim was
 * confirmed by the server during this visit. The distinction is client-side
 * only — the server never tells us who holds a seat, so a seat that was
 * already taken on load stays generic `claimed`.
 */
type SeatState = 'open' | 'claimed' | 'mine';

type SeatObject = {
  data: Seat;
  state: SeatState;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  home: THREE.Vector3;
  hover: number; // eased 0..1
  flash: number; // seconds remaining on a rejection flash
  shake: number; // seconds remaining on a shake
  busy: boolean;
};

const COLS = 3;
const SPACING = 2.35;
const SIZE = 1.6;
const DEPTH = 0.42;

export default function SeatGrid({ seats }: { seats: Seat[] }) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // ── Tokens ─────────────────────────────────────────────────────────────
    // Every colour and motion constant is read from design-tokens.css. None
    // are written here, so changing the stylesheet changes the scene.
    const css = getComputedStyle(document.documentElement);
    const token = (name: string) => css.getPropertyValue(name).trim();
    const color = (name: string) => new THREE.Color(token(name));

    const BG = color('--bg');
    const BG_2 = color('--bg-2');
    const INK = color('--ink');
    const INK_DIM = color('--ink-dim');
    const ACCENT = color('--accent');
    const FOG = color('--fog');
    const CAM_DAMP = parseFloat(token('--cam-damp')) || 5;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ── Scene ──────────────────────────────────────────────────────────────
    const scene = new THREE.Scene();
    scene.background = BG;
    scene.fog = new THREE.Fog(FOG, 12, 26);

    const camera = new THREE.PerspectiveCamera(
      42,
      mount.clientWidth / mount.clientHeight,
      0.1,
      100,
    );
    const camHome = new THREE.Vector3(0, 1.6, 11);
    camera.position.copy(camHome);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    mount.appendChild(renderer.domElement);

    // Light tints derived from the palette, per the design-tokens rule.
    scene.add(new THREE.AmbientLight(INK_DIM, 0.55));
    const key = new THREE.DirectionalLight(INK, 1.5);
    key.position.set(4, 7, 6);
    scene.add(key);
    const rim = new THREE.DirectionalLight(ACCENT, 0.5);
    rim.position.set(-6, 2, -4);
    scene.add(rim);

    // ── Geometry: an extruded rounded block ────────────────────────────────
    const shape = new THREE.Shape();
    const r = 0.18;
    const h = SIZE / 2;
    shape.moveTo(-h + r, -h);
    shape.lineTo(h - r, -h);
    shape.quadraticCurveTo(h, -h, h, -h + r);
    shape.lineTo(h, h - r);
    shape.quadraticCurveTo(h, h, h - r, h);
    shape.lineTo(-h + r, h);
    shape.quadraticCurveTo(-h, h, -h, h - r);
    shape.lineTo(-h, -h + r);
    shape.quadraticCurveTo(-h, -h, -h + r, -h);

    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: DEPTH,
      bevelEnabled: true,
      bevelThickness: 0.05,
      bevelSize: 0.05,
      bevelSegments: 3,
      curveSegments: 8,
    });
    geometry.center();

    // ── Layout: derive the grid from the real labels (A1..B3) ──────────────
    const rowKeys = [...new Set(seats.map((s) => s.label[0]))].sort();
    const position = (seat: Seat, index: number) => {
      const rowIndex = rowKeys.indexOf(seat.label[0]);
      const colIndex = Number(seat.label.slice(1)) - 1;
      const row = rowIndex >= 0 ? rowIndex : Math.floor(index / COLS);
      const col = Number.isFinite(colIndex) && colIndex >= 0 ? colIndex : index % COLS;
      const rows = Math.max(rowKeys.length, 1);
      return new THREE.Vector3(
        (col - (COLS - 1) / 2) * SPACING,
        ((rows - 1) / 2 - row) * SPACING,
        0,
      );
    };

    const paint = (seat: SeatObject) => {
      const material = seat.mesh.material;
      if (seat.state === 'mine') {
        material.color.copy(BG_2);
        material.emissive.copy(ACCENT);
        material.emissiveIntensity = 0.9;
        material.roughness = 0.32;
      } else if (seat.state === 'claimed') {
        material.color.copy(BG_2);
        material.emissive.copy(BG);
        material.emissiveIntensity = 0.15;
        material.roughness = 0.85;
      } else {
        material.color.copy(BG_2);
        material.emissive.copy(INK_DIM);
        material.emissiveIntensity = 0.16;
        material.roughness = 0.55;
      }
    };

    const objects: SeatObject[] = seats.map((seat, index) => {
      const material = new THREE.MeshStandardMaterial({
        color: BG_2,
        emissive: INK_DIM,
        emissiveIntensity: 0.16,
        roughness: 0.55,
        metalness: 0.12,
      });
      const mesh = new THREE.Mesh(geometry, material);
      const home = position(seat, index);
      mesh.position.copy(home);

      const object: SeatObject = {
        data: seat,
        state: seat.status === 'claimed' ? 'claimed' : 'open',
        mesh,
        home,
        hover: 0,
        flash: 0,
        shake: 0,
        busy: false,
      };
      paint(object);
      scene.add(mesh);
      return object;
    });

    // ── Particle burst, fired only from a confirmed server response ────────
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
        positions[i * 3 + 1] = at.y;
        positions[i * 3 + 2] = at.z + DEPTH / 2;

        // Outward in a flattened sphere so the burst reads against the grid.
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
        color: ACCENT,
        size: 0.075,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const points = new THREE.Points(burstGeometry, material);
      scene.add(points);

      const maxLife = reducedMotion ? 0.5 : 1.15;
      bursts.push({ points, velocities, life: maxLife, maxLife, material, geometry: burstGeometry });
    };

    // ── Interaction ────────────────────────────────────────────────────────
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let hovered: SeatObject | null = null;

    const updatePointer = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    };

    const pick = (): SeatObject | null => {
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(objects.map((o) => o.mesh), false)[0];
      if (!hit) return null;
      return objects.find((o) => o.mesh === hit.object) ?? null;
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
    const claim = async (seat: SeatObject) => {
      if (seat.busy || seat.state !== 'open') return;
      seat.busy = true;

      try {
        const response = await fetch(`/api/seats/${seat.data.id}/claim`, {
          method: 'POST',
          credentials: 'same-origin', // carry the session cookie
        });

        if (response.status === 200) {
          seat.state = 'mine';
          paint(seat);
          spawnBurst(seat.home);
        } else if (response.status === 409) {
          // Someone else holds it. The server just told us the truth about a
          // seat we believed was open, so correct the view.
          seat.state = 'claimed';
          paint(seat);
          seat.shake = 0.42;
        } else {
          // 403 cap reached, 429 rate limited, 4xx/5xx otherwise. The seat is
          // still open — only the caller was refused.
          seat.flash = 0.55;
        }
      } catch {
        seat.flash = 0.55; // network failure: refuse silently, change nothing
      } finally {
        seat.busy = false;
      }
    };

    const onClick = (event: PointerEvent) => {
      updatePointer(event);
      const seat = pick();
      if (seat) void claim(seat);
    };

    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('click', onClick as EventListener);

    // ── Loop ───────────────────────────────────────────────────────────────
    // Plain timing rather than THREE.Clock, which is deprecated in this
    // version. dt is clamped so a backgrounded tab cannot resume with a huge
    // step and teleport the animation.
    const started = performance.now();
    let last = started;
    let frame = 0;
    const target = new THREE.Vector3();
    const scratch = new THREE.Color();

    const tick = () => {
      frame = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const t = (now - started) / 1000;

      // Ambient drift: the camera breathes around its home position and eases
      // toward it frame-rate independently (1 - exp(-rate*dt)), never tied to
      // frame count.
      if (!reducedMotion) {
        target.set(
          camHome.x + Math.sin(t * 0.16) * 1.25,
          camHome.y + Math.sin(t * 0.11 + 1.3) * 0.5,
          camHome.z + Math.sin(t * 0.09) * 0.5,
        );
      } else {
        target.copy(camHome);
      }
      const ease = 1 - Math.exp(-CAM_DAMP * 0.1 * dt);
      camera.position.lerp(target, ease);
      camera.lookAt(0, 0, 0);

      for (const seat of objects) {
        const wantHover = seat === hovered && seat.state === 'open' && !seat.busy ? 1 : 0;
        seat.hover += (wantHover - seat.hover) * (1 - Math.exp(-12 * dt));

        let x = seat.home.x;
        if (seat.shake > 0) {
          seat.shake = Math.max(0, seat.shake - dt);
          x += Math.sin(seat.shake * 70) * seat.shake * 0.16;
        }

        seat.mesh.position.set(x, seat.home.y, seat.home.z + seat.hover * 0.42);
        seat.mesh.rotation.y = seat.hover * 0.16;

        const material = seat.mesh.material;
        if (seat.flash > 0) {
          seat.flash = Math.max(0, seat.flash - dt);
          // Rejection reads as the accent pulsing without the seat changing
          // state — it stays open, the caller was simply refused.
          material.emissive.copy(ACCENT);
          material.emissiveIntensity = 0.2 + Math.sin(seat.flash * 30) * 0.5 * seat.flash;
          if (seat.flash === 0) paint(seat);
        } else if (seat.state === 'open') {
          material.emissive.copy(scratch.copy(INK_DIM).lerp(INK, seat.hover));
          material.emissiveIntensity = 0.16 + seat.hover * 0.5;
        } else if (seat.state === 'mine') {
          material.emissiveIntensity = 0.75 + Math.sin(t * 1.6) * 0.12;
        }
      }

      for (let i = bursts.length - 1; i >= 0; i--) {
        const burst = bursts[i];
        burst.life -= dt;
        if (burst.life <= 0) {
          scene.remove(burst.points);
          burst.geometry.dispose();
          burst.material.dispose();
          bursts.splice(i, 1);
          continue;
        }
        const attribute = burst.geometry.getAttribute('position') as THREE.BufferAttribute;
        const array = attribute.array as Float32Array;
        for (let p = 0; p < array.length; p += 3) {
          array[p] += burst.velocities[p] * dt;
          array[p + 1] += burst.velocities[p + 1] * dt - 1.1 * dt * dt * 30;
          array[p + 2] += burst.velocities[p + 2] * dt;
          burst.velocities[p + 1] -= 3.2 * dt; // gravity
        }
        attribute.needsUpdate = true;
        burst.material.opacity = burst.life / burst.maxLife;
      }

      renderer.render(scene, camera);
    };

    // Render only while the grid is actually on screen. The story section
    // above it is a full viewport tall, so without this the scene burns the
    // main thread at 60fps while nobody is looking at it — which also wrecks
    // Total Blocking Time in a Lighthouse run.
    let running = false;
    const start = () => {
      if (running) return;
      running = true;
      last = performance.now(); // avoid a huge dt after being paused
      frame = requestAnimationFrame(tick);
    };
    const stop = () => {
      if (!running) return;
      running = false;
      cancelAnimationFrame(frame);
    };

    const visibility = new IntersectionObserver(
      ([entry]) => (entry.isIntersecting ? start() : stop()),
      { threshold: 0 },
    );
    visibility.observe(mount);

    // Paint one frame immediately so the grid is never blank before the
    // observer fires.
    renderer.render(scene, camera);

    // ── Resize ─────────────────────────────────────────────────────────────
    const onResize = () => {
      if (!mount.clientWidth || !mount.clientHeight) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(mount);

    // ── Teardown ───────────────────────────────────────────────────────────
    return () => {
      cancelAnimationFrame(frame);
      visibility.disconnect();
      observer.disconnect();
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('click', onClick as EventListener);
      for (const seat of objects) seat.mesh.material.dispose();
      for (const burst of bursts) {
        burst.geometry.dispose();
        burst.material.dispose();
      }
      geometry.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [seats]);

  // Absolute, not fixed: the grid is a section of the page now, sitting below
  // the story rather than owning the whole viewport.
  return <div ref={mountRef} className="absolute inset-0" aria-hidden="true" />;
}
