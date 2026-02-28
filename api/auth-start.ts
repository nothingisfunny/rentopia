import type { VercelRequest, VercelResponse } from '@vercel/node';
import { buildAuthUrl } from '../lib/gmail.js';

export default function handler(_req: VercelRequest, res: VercelResponse) {
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
