import type { VercelRequest, VercelResponse } from '@vercel/node';
import { buildAuthUrl } from '../lib/gmail.js';
import { applyCors } from '../lib/cors.js';

export default function handler(_req: VercelRequest, res: VercelResponse) {
  if (applyCors(_req, res, ['GET'])) return;

  if (_req.method !== 'GET') {
    res.status(405).send('Method not allowed');
    return;
  }

  try {
    const url = buildAuthUrl();
    res.writeHead(302, { Location: url });
    res.end();
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}
