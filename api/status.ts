import type { VercelRequest, VercelResponse } from '@vercel/node';
import prisma from '../lib/prisma.js';
import { applyCors } from '../lib/cors.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res, ['GET'])) return;
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const token = await prisma.oAuthToken.findFirst({ orderBy: { createdAt: 'desc' } });
    res.status(200).json({
      connected: Boolean(token),
      email: token?.email ?? null
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}
