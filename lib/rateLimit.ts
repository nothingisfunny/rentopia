const memoryTimestamps = new Map<string, number>();

async function upstashSetIfNotExists(key: string, ttlSeconds: number): Promise<boolean> {
  const baseUrl = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!baseUrl || !token) return false;

  const res = await fetch(`${baseUrl}/set/${encodeURIComponent(key)}/1/EX/${ttlSeconds}/NX`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`Upstash rate limit error: ${res.status}`);
  const body = await res.json();
  return body.result === 'OK';
}

export async function enforceRateLimit(ip: string, ttlSeconds = 30) {
  const key = `ingest:${ip}`;
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    const allowed = await upstashSetIfNotExists(key, ttlSeconds);
    if (!allowed) throw new Error('Rate limit: one ingest every 30 seconds per IP');
    return;
  }

  const now = Date.now();
  const last = memoryTimestamps.get(key) || 0;
  if (now - last < ttlSeconds * 1000) {
    throw new Error('Rate limit: one ingest every 30 seconds per IP');
  }
  memoryTimestamps.set(key, now);
  setTimeout(() => memoryTimestamps.delete(key), ttlSeconds * 1000).unref?.();
}
