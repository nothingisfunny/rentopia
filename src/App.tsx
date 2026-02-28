import { useEffect, useMemo, useState } from 'react';

interface Listing {
  id: string;
  url: string;
  source: string;
  title: string | null;
  latestSeenAt: string;
}

interface RecentResponse {
  listings: Listing[];
  count: number;
}

export default function App() {
  const [minutes, setMinutes] = useState(60);
  const [sourceFilter, setSourceFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [recent, setRecent] = useState<RecentResponse | null>(null);
  const [error, setError] = useState('');
  const [lastRun, setLastRun] = useState<Date | null>(null);

  const queryParams = useMemo(() => {
    const params = new URLSearchParams({ minutes: minutes.toString() });
    if (sourceFilter !== 'all') params.set('source', sourceFilter);
    if (search.trim()) params.set('q', search.trim());
    return params.toString();
  }, [minutes, sourceFilter, search]);

  const fetchRecent = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/recent?${queryParams}`);
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
    fetchRecent();
    const interval = setInterval(fetchRecent, 60_000);
    return () => clearInterval(interval);
  }, [queryParams]);

  const ingest = async () => {
    setIngesting(true);
    setError('');
    try {
      const res = await fetch(`/api/ingest?minutes=${minutes}`, {
        method: 'POST'
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

  return (
    <div className="container">
      <div className="header">
        <div>
          <div className="badge">Alert Tracker MVP</div>
          <h1>Fresh apartments from your Gmail alerts</h1>
          <p>Reads Gmail label <code>apt-alerts</code>, dedupes links, shows what appeared in the last hour.</p>
        </div>
        <div className="input-row">
          <button onClick={() => (window.location.href = '/api/auth/start')}>Connect Gmail</button>
          <button onClick={ingest} disabled={ingesting}>
            {ingesting ? 'Ingesting…' : 'Ingest last hour'}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="input-row">
          <label>
            Minutes window
            <input
              type="number"
              min={5}
              max={360}
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value) || 60)}
            />
          </label>
          <label>
            Source
            <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="facebook">Facebook</option>
              <option value="craigslist">Craigslist</option>
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
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <button onClick={fetchRecent} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh now'}
          </button>
        </div>
      </div>

      {error && <div className="card" style={{ color: '#b91c1c' }}>⚠️ {error}</div>}

      <div className="card">
        <div className="meta" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <strong>{recent?.count ?? 0} listings in last {minutes} min</strong>
          {lastRun && <span>Last ingest: {lastRun.toLocaleTimeString()}</span>}
        </div>
        <div className="listings">
          {recent?.listings.map((l) => (
            <div key={l.id} className="listing">
              <div className="meta">
                <span className="badge" style={{ background: '#e2e8f0', color: '#0f172a' }}>{l.source}</span>
                <span>{new Date(l.latestSeenAt).toLocaleTimeString()}</span>
              </div>
              <a href={l.url} target="_blank" rel="noreferrer">
                {l.title || l.url}
              </a>
            </div>
          )) || <p>No listings yet.</p>}
        </div>
      </div>

      <footer>
        Keep alerts flowing by labeling incoming emails as <strong>apt-alerts</strong> in Gmail.
      </footer>
    </div>
  );
}
