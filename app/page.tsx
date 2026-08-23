import { sql } from '@/lib/db';
import SeatGrid, { type Seat } from '@/components/SeatGrid';
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
      <StorySection claimed={claimed} total={seats.length} />

      <section id="grid" className="relative h-screen w-full">
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
        <SeatGrid seats={seats} />
      </section>
    </main>
  );
}
