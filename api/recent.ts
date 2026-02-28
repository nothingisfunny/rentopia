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

  const source = (req.query.source as string | undefined) || undefined;
  const q = (req.query.q as string | undefined)?.trim();
  const page = Math.max(1, Number(req.query.page ?? 1));
  const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize ?? 20)));
  const skip = (page - 1) * pageSize;

  try {
    const where = {
      ...(source && source !== 'all' ? { source } : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: 'insensitive' } },
              { url: { contains: q, mode: 'insensitive' } }
            ]
          }
        : {})
    };

    const [listings, total] = await Promise.all([
      prisma.listing.findMany({
        where,
        orderBy: { latestSeenAt: 'desc' },
        skip,
        take: pageSize
      }),
      prisma.listing.count({ where })
    ]);

    res.status(200).json({
      listings,
      count: listings.length,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize))
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}
