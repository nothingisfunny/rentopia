import type { VercelRequest, VercelResponse } from '@vercel/node';

export function requireAppPassword(req: VercelRequest, res: VercelResponse): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return false; // no password required

  const provided =
    (req.headers['x-app-password'] as string | undefined) ||
    (req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '');

  if (provided === expected) return false;

  res.status(401).json({ error: 'Unauthorized' });
  return true;
}
