import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/**
 * The seat object — geometry, proportions and materials.
 *
 * This module is the single source for what a seat looks like. The hero seat
 * at the top of the page and every seat in the grid below are built from the
 * same call, sharing the same four geometries, so the two halves of the page
 * can never drift apart visually.
 *
 * ── Why it isn't a cube ──────────────────────────────────────────────────
 * A uniform block with hard corners reads as a placeholder. This is a
 * considered object instead: wider than it is tall (1.90 × 1.40), built from
 * a cushion and a separate, slightly reclined back — and the back is split
 * into two rails with a real channel between them.
 *
 * The lit indicator sits INSIDE that channel, recessed 0.14 behind the front
 * face of the back panel. It is a real inset part with its own geometry and
 * its own material, not a colour band painted onto a face: the rails cast
 * into it, so the light reads as coming from a recess.
 *
 * ── Colour ───────────────────────────────────────────────────────────────
 * No colour is chosen here. Every value is passed in from design-tokens.css
 * by the caller, per the rule in CLAUDE.md.
 */

/** Objects on this layer — and only these — are rendered into the bloom pass. */
export const BLOOM_LAYER = 1;

/** Bevel radius. Small enough to read as a machined edge, not a rounded pill. */
const BEVEL = 0.045;

// ── Proportions (world units; the seat stands on y = 0) ──────────────────
const CUSHION_W = 1.9;
const CUSHION_H = 0.42;
const CUSHION_D = 1.1;

const BACK_W = 1.74;
const BACK_D = 0.26;
const BACK_TILT = -0.07; // radians; the back leans away from the sitter

const RAIL_H = 0.2; // lower rail, below the channel
const CHANNEL_H = 0.16; // the gap the indicator sits in
const PANEL_H = 0.62; // upper panel, above the channel

const ACCENT_W = 1.52;
const ACCENT_H = 0.155;
const ACCENT_D = 0.12;
/**
 * The indicator's back face is flush with the back of the rails, so what is
 * left over — BACK_D - ACCENT_D — is a real recess in front of it: 0.14 of
 * shadowed channel between the light and the outside of the seat.
 */
const ACCENT_RECESS = BACK_D - ACCENT_D;

export const SEAT_WIDTH = CUSHION_W;
export const SEAT_HEIGHT = CUSHION_H + RAIL_H + CHANNEL_H + PANEL_H;
export const SEAT_DEPTH = CUSHION_D + BACK_D;

/** Height of the indicator channel above the floor — the seat's optical centre. */
export const SEAT_EYE = CUSHION_H + RAIL_H + CHANNEL_H / 2;

export type SeatTokens = {
  /** Body colour — the raised-surface token. */
  surface: THREE.Color;
  /** The near-black base, used to sink a claimed seat back into the dark. */
  base: THREE.Color;
  /** Bone white — the standby indicator. */
  ink: THREE.Color;
  /** Secondary text colour — dimmed standby. */
  inkDim: THREE.Color;
  /** The one bold colour. Reserved for a seat this session actually won. */
  accent: THREE.Color;
};

export type SeatVisualState = 'open' | 'claimed' | 'mine';

export type SeatObject3D = {
  group: THREE.Group;
  /** Matte body. Shared by the cushion and both back rails of one seat. */
  body: THREE.MeshStandardMaterial;
  /** The inset indicator. A genuinely separate material with real emissive. */
  accent: THREE.MeshStandardMaterial;
  /** Everything the raycaster should test against for this seat. */
  meshes: THREE.Mesh[];
};

/**
 * The four geometries every seat shares. Built once, disposed once.
 */
export function createSeatGeometry() {
  return {
    cushion: new RoundedBoxGeometry(CUSHION_W, CUSHION_H, CUSHION_D, 3, BEVEL),
    rail: new RoundedBoxGeometry(BACK_W, RAIL_H, BACK_D, 3, BEVEL),
    panel: new RoundedBoxGeometry(BACK_W, PANEL_H, BACK_D, 3, BEVEL),
    accent: new RoundedBoxGeometry(ACCENT_W, ACCENT_H, ACCENT_D, 2, 0.03),
  };
}

export type SeatGeometry = ReturnType<typeof createSeatGeometry>;

export function disposeSeatGeometry(geometry: SeatGeometry) {
  for (const g of Object.values(geometry)) g.dispose();
}

/**
 * Build one seat.
 *
 * Geometry is shared with every other seat; the two materials are per-seat,
 * because state and reveal opacity are per-seat.
 */
export function createSeatObject(geometry: SeatGeometry, tokens: SeatTokens): SeatObject3D {
  // PBR values chosen for a matte, slightly dense material: not the plastic
  // sheen of MeshStandardMaterial's defaults (roughness 1 / metalness 0 give
  // a dead surface; low roughness gives a toy). 0.45/0.15 keeps a soft, broad
  // specular that the rim light can catch along an edge.
  const body = new THREE.MeshStandardMaterial({
    color: tokens.surface,
    roughness: 0.45,
    metalness: 0.15,
    transparent: true, // seats fade in as the camera pulls back
    opacity: 1,
  });

  // The indicator is lit, not shaded: near-black albedo so it reads as an
  // emitter rather than a painted panel, and a low roughness so the recess
  // catches a hot line along its bevel.
  const accent = new THREE.MeshStandardMaterial({
    color: tokens.base,
    emissive: tokens.inkDim,
    emissiveIntensity: 0.26,
    roughness: 0.5,
    metalness: 0,
    transparent: true,
    opacity: 1,
  });

  const group = new THREE.Group();

  const cushion = new THREE.Mesh(geometry.cushion, body);
  cushion.position.y = CUSHION_H / 2;

  // The back is a sub-group so the whole assembly — rails, channel and the
  // indicator inside it — tilts together and stays aligned.
  const back = new THREE.Group();
  back.position.set(0, CUSHION_H, -(CUSHION_D / 2));
  back.rotation.x = BACK_TILT;

  const rail = new THREE.Mesh(geometry.rail, body);
  rail.position.set(0, RAIL_H / 2, -(BACK_D / 2));

  const panel = new THREE.Mesh(geometry.panel, body);
  panel.position.set(0, RAIL_H + CHANNEL_H + PANEL_H / 2, -(BACK_D / 2));

  const indicator = new THREE.Mesh(geometry.accent, accent);
  indicator.position.set(0, RAIL_H + CHANNEL_H / 2, -(BACK_D / 2) - ACCENT_RECESS / 2);
  // Only the lit part reaches the bloom pass. The body never does, which is
  // what keeps the bloom on light instead of smearing the whole object.
  indicator.layers.enable(BLOOM_LAYER);

  back.add(rail, panel, indicator);
  group.add(cushion, back);

  return { group, body, accent, meshes: [cushion, rail, panel, indicator] };
}

/**
 * Apply a seat's state to its materials.
 *
 * The body barely changes — a real object doesn't repaint itself. The state
 * is carried by the inset indicator, exactly as a physical seat's status
 * light would carry it, with a claimed seat additionally sinking toward the
 * background so the grid reads at a glance.
 */
export function paintSeat(
  seat: SeatObject3D,
  state: SeatVisualState,
  tokens: SeatTokens,
) {
  if (state === 'mine') {
    seat.body.color.copy(tokens.surface);
    seat.body.roughness = 0.42;
    seat.accent.emissive.copy(tokens.accent);
    seat.accent.emissiveIntensity = 2.6; // above 1 so it carries the bloom
  } else if (state === 'claimed') {
    // Taken by someone else: the light is out and the body sinks back.
    seat.body.color.copy(tokens.surface).lerp(tokens.base, 0.65);
    seat.body.roughness = 0.62;
    seat.accent.emissive.copy(tokens.inkDim);
    seat.accent.emissiveIntensity = 0.05;
  } else {
    seat.body.color.copy(tokens.surface);
    seat.body.roughness = 0.45;
    seat.accent.emissive.copy(tokens.inkDim);
    seat.accent.emissiveIntensity = 0.26;
  }
}
