import { sql } from '@/lib/db';
import SeatScene, { type Seat } from '@/components/SeatScene';
import StorySection from '@/components/StorySection';

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
        <ul className="sr-only">
          {seats.map((seat) => (
            <li key={seat.id}>
              Seat {seat.label}: {seat.status === 'claimed' ? 'already taken' : 'available'}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
