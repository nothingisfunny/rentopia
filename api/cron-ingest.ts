import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const secret = process.env.CRON_SECRET;
  if (!secret || req.query.secret !== secret) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const appPassword = process.env.APP_PASSWORD || '';
  const minutes = Number(req.query.minutes ?? 60);
  const target = `${process.env.APP_ORIGIN?.replace(/\/$/, '') || 'http://localhost:3000'}/api/ingest?minutes=${minutes}`;

  try {
    const resp = await fetch(target, {
      method: 'POST',
      headers: appPassword ? { 'x-app-password': appPassword } : {}
    });
    const text = await resp.text();
    res.status(resp.status).send(text);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}
