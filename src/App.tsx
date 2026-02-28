import { useEffect, useMemo, useState } from 'react';

interface Listing {
  id: string;
  url: string;
  source: string;
  title: string | null;
  price?: number | null;
  thumbnailUrl?: string | null;
  description?: string | null;
  latestSeenAt: string;
}

interface RecentResponse {
  listings: Listing[];
  count: number;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const apiBase = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');

export default function App() {
  const [sourceFilter, setSourceFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [recent, setRecent] = useState<RecentResponse | null>(null);
  const [error, setError] = useState('');
  const [lastRun, setLastRun] = useState<Date | null>(null);
  const [connectedEmail, setConnectedEmail] = useState<string | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(true);
  const [password, setPassword] = useState(() => localStorage.getItem('appPassword') || '');
  const [hasPassword, setHasPassword] = useState(() => Boolean(localStorage.getItem('appPassword')));
  const [page, setPage] = useState(1);
  const pageSize = 12;

  const queryParams = useMemo(() => {
    const params = new URLSearchParams({ page: page.toString(), pageSize: pageSize.toString() });
    if (sourceFilter !== 'all') params.set('source', sourceFilter);
    if (search.trim()) params.set('q', search.trim());
    return params.toString();
  }, [sourceFilter, search, page]);

  const fetchRecent = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${apiBase}/api/recent?${queryParams}`, {
        headers: password ? { 'x-app-password': password } : {}
      });
      if (!res.ok) throw new Error(`Recent failed: ${res.status}`);
      const data = (await res.json()) as RecentResponse;
      setRecent(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!connectedEmail || !hasPassword) return;
    fetchRecent();
    const interval = setInterval(fetchRecent, 60_000);
    return () => clearInterval(interval);
  }, [queryParams, connectedEmail, hasPassword]);

  useEffect(() => {
    if (!hasPassword) return;
    const checkStatus = async () => {
      setCheckingStatus(true);
      try {
        const res = await fetch(`${apiBase}/api/status`, {
          headers: password ? { 'x-app-password': password } : {}
        });
        if (!res.ok) throw new Error(`Status failed: ${res.status}`);
        const data = await res.json();
        if (data.connected) {
          setConnectedEmail(data.email || 'connected');
        } else {
          setConnectedEmail(null);
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setCheckingStatus(false);
      }
    };
    checkStatus();
  }, [hasPassword, password]);

  const ingest = async () => {
    setIngesting(true);
    setError('');
    try {
      const res = await fetch(`${apiBase}/api/ingest?minutes=${minutes}`, {
        method: 'POST',
        headers: password ? { 'x-app-password': password } : {}
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Ingest failed (${res.status})`);
      }
      setLastRun(new Date());
      await fetchRecent();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIngesting(false);
    }
  };

  if (!hasPassword) {
    return (
      <div className="container">
        <div className="card" style={{ maxWidth: 480, margin: '40px auto' }}>
          <h2>Enter access password</h2>
          <div className="input-row">
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              onClick={() => {
                localStorage.setItem('appPassword', password);
                setHasPassword(true);
              }}
              disabled={!password}
            >
              Continue
            </button>
          </div>
          {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="header">
        <div>
          <div className="badge">Alert Tracker MVP</div>
          <h1>Fresh apartments from your Gmail alerts</h1>
          <p>Reads Gmail label <code>apt-alerts</code>, dedupes links, shows what appeared in the last hour.</p>
          {connectedEmail && (
            <p style={{ color: '#16a34a', fontWeight: 600 }}>Connected as {connectedEmail}</p>
          )}
        </div>
        <div className="input-row">
          {!connectedEmail && (
            <button onClick={() => (window.location.href = `${apiBase}/api/auth/start`)}>Connect Gmail</button>
          )}
          <button onClick={ingest} disabled={ingesting || !connectedEmail}>
            {ingesting ? 'Ingesting…' : 'Ingest last hour'}
          </button>
        </div>
      </div>

      {checkingStatus && <div className="card">Checking Gmail connection…</div>}

      {!connectedEmail && !checkingStatus && (
        <div className="card" style={{ color: '#b91c1c' }}>
          No Gmail account connected yet. Click “Connect Gmail” to authorize and start ingesting alerts.
        </div>
      )}

      {connectedEmail && (
        <div className="card">
          <div className="input-row">
            <label>
              Source
              <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
                <option value="all">All</option>
                <option value="craigslist">Craigslist</option>
                <option value="facebook">Facebook</option>
                <option value="streeteasy">StreetEasy</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              Search
              <input
                type="text"
                placeholder="keyword in title/snippet"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              />
            </label>
          </div>
        </div>
      )}

      {error && <div className="card" style={{ color: '#b91c1c' }}>⚠️ {error}</div>}

      {connectedEmail && (
        <div className="card">
          <div className="meta" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <strong>{recent?.total ?? 0} listings</strong>
            {lastRun && <span>Last ingest: {lastRun.toLocaleTimeString()}</span>}
          </div>
          <div className="listings">
            {recent?.listings.map((l) => (
              <div key={l.id} className="listing">
                <div className="meta">
                  <span className="badge" style={{ background: '#e2e8f0', color: '#0f172a' }}>{l.source}</span>
                  <span>{new Date(l.latestSeenAt).toLocaleTimeString()}</span>
                </div>
                {l.thumbnailUrl && (
                  <a href={l.url} target="_blank" rel="noreferrer">
                    <img src={l.thumbnailUrl} alt={l.title || 'listing photo'} style={{ width: '100%', borderRadius: 10, objectFit: 'cover', maxHeight: 160 }} />
                  </a>
                )}
                <a href={l.url} target="_blank" rel="noreferrer" style={{ fontWeight: 700 }}>
                  {l.price ? `$${l.price.toLocaleString()} - ` : ''}{l.title || l.url}
                </a>
                {l.description && (
                  <p style={{ margin: '4px 0 0 0', color: '#475569', fontSize: 14 }}>
                    {l.description}
                  </p>
                )}
              </div>
            )) || <p>No listings yet.</p>}
          </div>
          {recent && recent.totalPages > 1 && (
            <div className="input-row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
              <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</button>
              <span>Page {page} of {recent.totalPages}</span>
              <button disabled={page >= (recent.totalPages || 1)} onClick={() => setPage((p) => Math.min(recent.totalPages, p + 1))}>Next</button>
            </div>
          )}
        </div>
      )}

      <footer>
        Keep alerts flowing by labeling incoming emails as <strong>apt-alerts</strong> in Gmail.
      </footer>
    </div>
  );
}
