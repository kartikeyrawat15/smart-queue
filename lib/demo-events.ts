/**
 * The contract between the HUD and the 3D scene.
 *
 * The scene lives inside one long-lived effect that owns a WebGL context, a
 * render loop and ~24 meshes. Driving it through React props would tear that
 * whole thing down and rebuild it on every HUD interaction, so the two talk
 * over window events instead: the HUD says what happened, the scene decides
 * how to show it, and neither re-renders the other.
 */

/** HUD → scene: a stress run finished; play it out on this seat. */
export const STRESS_EVENT = 'sq:stress';

/** HUD → scene: every seat is open again. */
export const RESET_EVENT = 'sq:reset';

/** Scene → HUD: the seat tally changed, whatever caused it. */
export const SEATS_EVENT = 'sq:seats';

/**
 * Scene → HUD: the server answered a click on a seat.
 *
 * A click happens on the canvas, so the outcome is otherwise only ever drawn
 * — the seat lights up, or shakes. This carries the same outcome back out as
 * words, so the HUD can say which of them just happened and why.
 */
export const CLAIM_EVENT = 'sq:claim';

export type StressDetail = {
  seatId: string;
  /** Real counts from the server. Always 1 and N-1 unless something is wrong. */
  winners: number;
  rejected: number;
};

export type SeatsDetail = {
  open: number;
  claimed: number;
};

export type ClaimDetail = {
  label: string;
  /**
   * `mine` — 200, this browser holds it.
   * `taken` — 409, someone else got there first and the view was corrected.
   * `refused` — the caller was refused (cap, rate limit, network); the seat
   *   itself did not change.
   */
  outcome: 'mine' | 'taken' | 'refused';
};
