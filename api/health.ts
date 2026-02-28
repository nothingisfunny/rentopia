import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors } from '../lib/cors.js';
import { requireAppPassword } from '../lib/auth.js';

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res, ['GET', 'HEAD'])) return;
  if (requireAppPassword(req, res)) return;

  if (req.method === 'HEAD') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  res.status(200).json({ status: 'ok', time: new Date().toISOString() });
}
