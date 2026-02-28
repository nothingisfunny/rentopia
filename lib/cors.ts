import type { VercelRequest, VercelResponse } from '@vercel/node';

function pickOrigin(reqOrigin: string | undefined, allowed: string[]): string | undefined {
  if (!reqOrigin) return undefined;
  const normalized = reqOrigin.replace(/\/$/, '');
  return allowed.find((o) => o.replace(/\/$/, '') === normalized);
}

export function applyCors(req: VercelRequest, res: VercelResponse, methods: string[]): boolean {
  const allowList = (process.env.APP_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const originToAllow = pickOrigin(req.headers.origin as string | undefined, allowList) || allowList[0];

  if (originToAllow) res.setHeader('Access-Control-Allow-Origin', originToAllow);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', [...methods, 'OPTIONS'].join(','));
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true; // handled
  }
  return false;
}
