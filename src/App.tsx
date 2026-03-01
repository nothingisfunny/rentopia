import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Card,
  Container,
  Flex,
  Grid,
  Heading,
  IconButton,
  Inset,
  Select,
  Separator,
  Text,
  TextField,
  Badge
} from '@radix-ui/themes';

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
  const [ingestingLatest, setIngestingLatest] = useState(false);
  const [recent, setRecent] = useState<RecentResponse | null>(null);
  const [error, setError] = useState('');
  const [lastRun, setLastRun] = useState<Date | null>(null);
  const [connectedEmail, setConnectedEmail] = useState<string | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(true);
  const [password, setPassword] = useState(() => localStorage.getItem('appPassword') || '');
  const [hasPassword, setHasPassword] = useState(() => Boolean(localStorage.getItem('appPassword')));
  const [page, setPage] = useState(1);
  const pageSize = 12;
  const [lastIngestAt, setLastIngestAt] = useState<string | null>(null);
  const [injectingLatest, setInjectingLatest] = useState(false);

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

  // Fetch last ingest time
  useEffect(() => {
    const fetchLast = async () => {
      if (!hasPassword) return;
      try {
        const res = await fetch(`${apiBase}/api/last-ingest`, {
          headers: password ? { 'x-app-password': password } : {}
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.lastIngestAt) setLastIngestAt(data.lastIngestAt);
      } catch {}
    };
    fetchLast();
  }, [hasPassword, password]);

  const ingest = async (sinceMs?: number) => {
    const params = new URLSearchParams();
    if (sinceMs) params.set('sinceMs', sinceMs.toString());
    const qs = params.toString();

    setIngesting(true);
    setError('');
    try {
      const res = await fetch(`${apiBase}/api/ingest${qs ? `?${qs}` : ''}`, {
        method: 'POST',
        headers: password ? { 'x-app-password': password } : {}
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Ingest failed (${res.status})`);
      }
      setLastRun(new Date());
      await fetchRecent();
      if (sinceMs) setLastIngestAt(new Date().toISOString());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIngesting(false);
    }
  };

  if (!hasPassword) {
    return (
      <Container size="2" px="4" py="6">
        <Card size="3" style={{ maxWidth: 520, margin: '40px auto' }}>
          <Heading size="4" mb="3">Enter access password</Heading>
          <Flex gap="3" align="center">
            <TextField.Root>
              <TextField.Input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </TextField.Root>
            <Button
              onClick={() => {
                localStorage.setItem('appPassword', password);
                setHasPassword(true);
              }}
              disabled={!password}
            >
              Continue
            </Button>
          </Flex>
          {error && <Text color="red" mt="2">{error}</Text>}
        </Card>
      </Container>
    );
  }

  return (
    <Container size="3" px="4" py="5">
      <Flex justify="between" align="center" wrap="wrap" gap="4" mb="4">
        <Box>
          <Text size="2" weight="medium" color="gray">Alert Tracker MVP</Text>
          <Heading size="6" mt="1">Fresh apartments from your Gmail alerts</Heading>
          {connectedEmail && (
            <Text size="2" color="green" weight="medium">Connected as {connectedEmail}</Text>
          )}
        </Box>
        <Flex gap="3">
          {!connectedEmail && (
            <Button onClick={() => (window.location.href = `${apiBase}/api/auth/start`)}>
              Connect Gmail
            </Button>
          )}
          <Button onClick={ingest} disabled={ingesting || !connectedEmail} variant="surface">
            {ingesting ? 'Ingesting…' : 'Ingest now'}
          </Button>
        </Flex>
      </Flex>

      {checkingStatus && <Card>Checking Gmail connection…</Card>}

      {!connectedEmail && !checkingStatus && (
        <Card>
          <Text color="red">No Gmail account connected yet. Click “Connect Gmail”.</Text>
        </Card>
      )}

      {connectedEmail && (
        <>
          <Card mb="3">
            <Flex gap="3" align="center" wrap="wrap">
              <Button
                onClick={async () => {
                  const since = lastIngestAt ? new Date(lastIngestAt).getTime() : undefined;
                  setInjectingLatest(true);
                  await ingest(since);
                  setInjectingLatest(false);
                }}
                disabled={injectingLatest || ingesting}
                variant="soft"
              >
                {injectingLatest ? 'Injecting latest…' : 'Fetch since last ingest'}
              </Button>
              {lastIngestAt && (
                <Text size="2" color="gray">
                  Last ingest at {new Date(lastIngestAt).toLocaleString()}
                </Text>
              )}
            </Flex>
          </Card>

          <Card mb="4">
            <Flex gap="3" wrap="wrap">
              <Box>
                <Text size="2" weight="medium">Source</Text>
                <Select.Root value={sourceFilter} onValueChange={(v) => { setSourceFilter(v); setPage(1); }}>
                  <Select.Trigger />
                  <Select.Content>
                    <Select.Item value="all">All</Select.Item>
                    <Select.Item value="craigslist">Craigslist</Select.Item>
                    <Select.Item value="facebook">Facebook</Select.Item>
                    <Select.Item value="streeteasy">StreetEasy</Select.Item>
                    <Select.Item value="other">Other</Select.Item>
                  </Select.Content>
                </Select.Root>
              </Box>
              <Box grow="1">
                <Text size="2" weight="medium">Search</Text>
                <TextField.Root
                  placeholder="keyword in title/description"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                />
              </Box>
            </Flex>
          </Card>
        </>
      )}

      {error && <Card><Text color="red">⚠️ {error}</Text></Card>}

      {connectedEmail && (
        <Card>
          <Flex justify="between" align="center" mb="3">
            <Text weight="bold">{recent?.total ?? 0} listings</Text>
            {lastRun && <Text size="2">Last ingest: {lastRun.toLocaleTimeString()}</Text>}
          </Flex>
          <Grid columns={{ initial: '1', sm: '2', md: '3' }} gap="3">
            {recent?.listings.map((l) => (
              <Card key={l.id} variant="surface" size="2" style={{ position: 'relative' }}>
                <Flex justify="end" align="center" style={{ position: 'absolute', top: 8, right: 8 }}>
                  <Badge color="purple" variant="solid" size="1">
                    {l.source}
                  </Badge>
                </Flex>
                {l.thumbnailUrl && (
                  <Inset clip="padding-box">
                    <img src={l.thumbnailUrl} alt={l.title || 'listing photo'} style={{ width: '100%', borderRadius: 10, objectFit: 'cover', maxHeight: 200 }} />
                  </Inset>
                )}
                <Flex justify="between" align="center" mt="2" mb="1">
                  <span />
                  <Text size="1" color="gray">{new Date(l.latestSeenAt).toLocaleTimeString()}</Text>
                </Flex>
                <Text size="2" style={{ display: 'block', marginTop: 4 }}>
                  {l.description || l.title || l.url}
                </Text>
                <Button asChild variant="soft" size="2" mt="2">
                  <a href={l.url} target="_blank" rel="noreferrer">View listing</a>
                </Button>
              </Card>
            )) || <Text>No listings yet.</Text>}
          </Grid>
          {recent && recent.totalPages > 1 && (
            <Flex justify="between" align="center" mt="3">
              <Button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} variant="soft">Prev</Button>
              <Text size="2">Page {page} of {recent.totalPages}</Text>
              <Button disabled={page >= (recent.totalPages || 1)} onClick={() => setPage((p) => Math.min(recent.totalPages, p + 1))} variant="soft">Next</Button>
            </Flex>
          )}
        </Card>
      )}
    </Container>
  );
}
