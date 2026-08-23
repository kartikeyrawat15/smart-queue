import { sql } from '@/lib/db';
import SeatGrid, { type Seat } from '@/components/SeatGrid';

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

  // The scene itself is a canvas, which is opaque to screen readers and
  // crawlers — and produces no contentful paint at all, so Lighthouse cannot
  // even measure the page. This text carries the same information in the DOM.
  // It is visually hidden, not a HUD.
  return (
    <>
      <h1 className="sr-only">Smart Queue — seat selection</h1>
      <ul className="sr-only">
        {seats.map((seat) => (
          <li key={seat.id}>
            Seat {seat.label}: {seat.status === 'claimed' ? 'already taken' : 'available'}
          </li>
        ))}
      </ul>
      <SeatGrid seats={seats} />
    </>
  );
}
