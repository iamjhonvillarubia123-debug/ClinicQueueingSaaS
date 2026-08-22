import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiRequest } from '../api/client';

type EstablishResult = {
  bookingReference: string;
};

export function BookingAccessBootstrapPage() {
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    const hash = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : window.location.hash;
    const token = new URLSearchParams(hash).get('token')?.trim() ?? '';

    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);

    if (!token) {
      setFailed(true);
      return () => { active = false; };
    }

    void apiRequest<EstablishResult>('/patient-bookings/access', {
      method: 'POST',
      body: { token },
    })
      .then((result) => {
        if (active) {
          navigate(`/patient-bookings/${encodeURIComponent(result.bookingReference)}`, { replace: true });
        }
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => { active = false; };
  }, [navigate]);

  return (
    <main className="public-detail">
      <header className="public-header"><Link className="brand" to="/">Clinic Queueing</Link></header>
      <section className="patient-dashboard patient-state">
        <p className="eyebrow">Secure appointment access</p>
        <h1>{failed ? 'This secure access link is unavailable.' : 'Opening your appointment…'}</h1>
        <p>{failed
          ? 'The link may be invalid, expired, or already replaced. Use appointment recovery from the clinic page if you still need access.'
          : 'The access credential is being moved into a protected browser cookie.'}</p>
      </section>
    </main>
  );
}
