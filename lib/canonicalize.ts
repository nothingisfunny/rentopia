import { createHash } from 'crypto';

const TRACKING_PREFIXES = ['utm_', 'mc_', 'gclid', 'fbclid'];
const TRACKING_EXACT = ['mc_cid', 'mc_eid'];

export function canonicalizeUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    url.hash = '';
    url.protocol = url.protocol.replace(':', '') === 'http' ? 'https:' : url.protocol;
    const params = url.searchParams;
    for (const key of Array.from(params.keys())) {
      if (TRACKING_EXACT.includes(key)) params.delete(key);
      if (TRACKING_PREFIXES.some((prefix) => key.startsWith(prefix))) params.delete(key);
    }
    url.search = params.toString();
    let pathname = url.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    url.pathname = pathname;
    url.hostname = url.hostname.toLowerCase();
    return url.toString();
  } catch {
    return null;
  }
}

export function hashUrl(url: string): string {
  return createHash('sha256').update(url).digest('hex');
}
