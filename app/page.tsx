import { sql } from '@/lib/db';
import SeatScene, { type Seat } from '@/components/SeatScene';
import StorySection from '@/components/StorySection';
import Hud from '@/components/Hud';

// Seat availability changes constantly; never serve a cached snapshot.
export const dynamic = 'force-dynamic';

export default async function Home() {
  const rows = await sql.query(
    `SELECT id, label, status FROM seats ORDER BY label`,
  );

  // Deliberately does not select claimed_by. The client needs to know a seat
  // is taken, not who took it — same non-disclosure rule the 409 response
  // follows.
  const seats: Seat[] = rows.map((row) => ({
    id: row.id as string,
    label: row.label as string,
    status: row.status as Seat['status'],
  }));

  const claimed = seats.filter((seat) => seat.status === 'claimed').length;

  return (
    <main>
      {/* One canvas for the whole page. It is fixed behind the content: the
          shot starts tight on a single seat beside the story copy and pulls
          back on scroll until the grid below is the frame. The story and the
          grid are not two scenes — they are two ends of one camera move. */}
      <SeatScene seats={seats} />

      <StorySection claimed={claimed} total={seats.length} />

      {/* Pointer events stay off so clicks reach the canvas underneath; the
          scene itself only accepts them once the camera has arrived here. */}
      <section id="grid" className="pointer-events-none relative z-10 h-screen w-full">
        {/* The canvas is opaque to screen readers and crawlers; this carries
            the same information in the DOM. Visually hidden, not a HUD. */}
        <h2 className="sr-only">Seat grid</h2>

        {/* Sits above the grid because a visitor arriving here has been shown
            the problem but not yet told what the thing in front of them
            responds to. Label styling, so it reads as chrome and not as
            another chapter of the story.

            No max-width: `ch` resolves against this element's own font size,
            so a cap in `ch` at label size is a few hundred pixels and shatters
            the sentence into six ragged lines. The gutter is the measure. */}
        <p
          className="absolute inset-x-0 top-0 mx-auto text-center"
          style={{
            paddingInline: 'var(--gutter)',
            paddingTop: 'clamp(24px, 6vh, 64px)',
            fontSize: 'var(--label)',
            letterSpacing: 'var(--tracking-label)',
            textTransform: 'uppercase',
            lineHeight: 1.7,
            color: 'var(--ink-dim)',
          }}
        >
          <span style={{ color: 'var(--ink)' }}>Try it</span> — click any seat to claim it, or run
          the stress test to watch 50 simultaneous claims resolve to exactly one winner.
        </p>
        <ul className="sr-only">
          {seats.map((seat) => (
            <li key={seat.id}>
              Seat {seat.label}: {seat.status === 'claimed' ? 'already taken' : 'available'}
            </li>
          ))}
        </ul>

        {/* Sits at the bottom of the grid section, so it comes into reach
            exactly when the camera arrives and the seats become clickable. */}
        <Hud initialOpen={seats.length - claimed} initialClaimed={claimed} />
      </section>
    </main>
  );
}
