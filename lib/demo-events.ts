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
