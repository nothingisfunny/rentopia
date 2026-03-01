import type { VercelRequest, VercelResponse } from '@vercel/node';
import prisma from '../lib/prisma.js';
import { applyCors } from '../lib/cors.js';
import { requireAppPassword } from '../lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res, ['GET'])) return;
  if (requireAppPassword(req, res)) return;
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const agg = await prisma.listingEvent.aggregate({
      _max: { receivedAt: true }
    });
    res.status(200).json({ lastIngestAt: agg._max.receivedAt ?? null });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}
