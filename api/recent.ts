import type { VercelRequest, VercelResponse } from '@vercel/node';
import prisma from '../lib/prisma.js';
import { applyCors } from '../lib/cors.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res, ['GET'])) return;

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const minutes = Number(req.query.minutes ?? 60);
  const source = (req.query.source as string | undefined) || undefined;
  const q = (req.query.q as string | undefined)?.trim();

  try {
    const listings = await prisma.listing.findMany({
      where: {
        latestSeenAt: { gte: new Date(Date.now() - minutes * 60 * 1000) },
        ...(source && source !== 'all' ? { source } : {}),
        ...(q
          ? {
              OR: [
                { title: { contains: q, mode: 'insensitive' } },
                { url: { contains: q, mode: 'insensitive' } }
              ]
            }
          : {})
      },
      orderBy: { latestSeenAt: 'desc' }
    });

    res.status(200).json({ listings, count: listings.length });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}
