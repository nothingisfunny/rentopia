import type { VercelRequest, VercelResponse } from '@vercel/node';
import { google } from 'googleapis';
import prisma from '../lib/prisma.js';
import { canonicalizeUrl, hashUrl } from '../lib/canonicalize.js';
import { extractUrls, extractFirstImage } from '../lib/extract.js';
import { enforceRateLimit } from '../lib/rateLimit.js';
import { getOAuthClient } from '../lib/gmail.js';
import { applyCors } from '../lib/cors.js';
import { requireAppPassword } from '../lib/auth.js';

interface GmailMessagePayload {
  mimeType?: string;
  body?: { size?: number; data?: string };
  parts?: GmailMessagePayload[];
}

function decodeBase64(data?: string): string {
  if (!data) return '';
  return Buffer.from(data, 'base64').toString('utf8');
}

function collectBodies(payload?: GmailMessagePayload, plain: string[] = [], html: string[] = []) {
  if (!payload) return;
  if (payload.mimeType === 'text/plain' && payload.body?.data) plain.push(decodeBase64(payload.body.data));
  if (payload.mimeType === 'text/html' && payload.body?.data) html.push(decodeBase64(payload.body.data));
  if (payload.parts) {
    for (const part of payload.parts) collectBodies(part, plain, html);
  }
}

function classifySource(url: URL): string {
  const host = url.hostname;
  const path = url.pathname;
  if (host.includes('facebook.com') && path.includes('/marketplace/') && path.includes('/item/')) return 'facebook';
  if (host.includes('craigslist.org')) return 'craigslist';
  if (host.includes('streeteasy.com')) return 'streeteasy';
  return 'other';
}

function parseCraigslistSubject(subject?: string) {
  if (!subject) return { price: null as number | null, title: null as string | null, isBrooklyn: false };
  const priceMatch = subject.match(/\$([\d,]+)/);
  const price = priceMatch ? Number(priceMatch[1].replace(/,/g, '')) : null;
  const parts = subject.split('-').map((p) => p.trim());
  const title = parts.length >= 3 ? parts.slice(2).join(' - ').trim() : subject.trim();
  const isBrooklyn = /\/brk|Brooklyn/i.test(subject);
  return { price, title, isBrooklyn };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res, ['POST'])) return;
  if (requireAppPassword(req, res)) return;

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const minutes = Number(req.query.minutes ?? 60);
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || 'unknown';

  try {
    await enforceRateLimit(ip, 30);
  } catch (err) {
    res.status(429).json({ error: (err as Error).message });
    return;
  }

  const token = await prisma.oAuthToken.findFirst({ orderBy: { createdAt: 'desc' } });
  if (!token) {
    res.status(400).json({ error: 'No connected Gmail account. Run /api/auth/start first.' });
    return;
  }

  try {
    const oauth = getOAuthClient();
    oauth.setCredentials({
      refresh_token: token.refreshToken,
      access_token: token.accessToken || undefined,
      expiry_date: token.expiryDate ? Number(token.expiryDate) : undefined
    });

    const needsRefresh = !token.accessToken || !token.expiryDate || Number(token.expiryDate) < Date.now() + 60_000;
    if (needsRefresh) {
      const { credentials } = await oauth.refreshAccessToken();
      await prisma.oAuthToken.update({
        where: { email: token.email },
        data: {
          accessToken: credentials.access_token || null,
          expiryDate: credentials.expiry_date ? BigInt(credentials.expiry_date) : null,
          refreshToken: credentials.refresh_token || token.refreshToken
        }
      });
      oauth.setCredentials(credentials);
    }

    const gmail = google.gmail({ version: 'v1', auth: oauth });
    const list = await gmail.users.messages.list({
      userId: 'me',
      q: `newer_than:${minutes}m`,
      maxResults: 50
    });

    const messages = list.data.messages || [];
    const scannedMessages = messages.length;
    const ids = messages.map((m) => m.id!).filter(Boolean);

    console.log('[ingest] minutes=%s messages=%s', minutes, scannedMessages);

    const existingEvents = ids.length
      ? await prisma.listingEvent.findMany({ where: { emailMessageId: { in: ids } }, select: { emailMessageId: true } })
      : [];
    const already = new Set(existingEvents.map((e) => e.emailMessageId));

    let newMessages = 0;
    let extractedUrls = 0;
    let newEvents = 0;
    let newUniqueListings = 0;

    for (const id of ids) {
      if (already.has(id)) continue;
      newMessages += 1;
      const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
      const payload = msg.data.payload as GmailMessagePayload | undefined;
      const headers = msg.data.payload?.headers || [];
      const from = headers.find((h) => h.name?.toLowerCase() === 'from')?.value;
      const subject = headers.find((h) => h.name?.toLowerCase() === 'subject')?.value;
      const internalDate = msg.data.internalDate ? Number(msg.data.internalDate) : Date.now();
      const receivedAt = new Date(internalDate);

      const plainParts: string[] = [];
      const htmlParts: string[] = [];
      collectBodies(payload, plainParts, htmlParts);
      const plain = plainParts.join('\n');
      const html = htmlParts.join('\n');
      const firstImage = extractFirstImage(html);

      const urls = extractUrls(plain, html);
      extractedUrls += urls.length;

      for (const rawUrl of urls) {
        const canonical = canonicalizeUrl(rawUrl);
        if (!canonical) continue;
        const urlObj = new URL(canonical);
        const source = classifySource(urlObj);
        if (source === 'craigslist' && !urlObj.pathname.includes('/apa')) continue; // only apts
        const urlHash = hashUrl(canonical);

        const { price, title: parsedTitle } = source === 'craigslist' ? parseCraigslistSubject(subject || plain) : { price: null, title: null };

        const existingListing = await prisma.listing.findUnique({ where: { urlHash } });
        let listingId: string;
        if (existingListing) {
          await prisma.listing.update({
            where: { urlHash },
            data: { latestSeenAt: receivedAt }
          });
          listingId = existingListing.id;
        } else {
          const created = await prisma.listing.create({
            data: {
              url: canonical,
              urlHash,
              source,
              title: parsedTitle || subject || plain.slice(0, 140) || null,
              price,
              thumbnailUrl: firstImage,
              latestSeenAt: receivedAt
            }
          });
          listingId = created.id;
          newUniqueListings += 1;
        }

        try {
          await prisma.listingEvent.create({
            data: {
              urlHash,
              emailMessageId: id,
              receivedAt,
              from: from || null,
              subject: subject || null,
              snippet: plain.slice(0, 200) || null,
              source,
              listingId
            }
          });
          newEvents += 1;
        } catch (err) {
          // ignore unique constraint collisions
          console.warn('[ingest] duplicate event', err);
        }
      }
    }

    console.log('[ingest] newMessages=%s extractedUrls=%s newEvents=%s newUniqueListings=%s', newMessages, extractedUrls, newEvents, newUniqueListings);

    const recentUniqueListings = await prisma.listing.findMany({
      where: { latestSeenAt: { gte: new Date(Date.now() - minutes * 60 * 1000) } },
      orderBy: { latestSeenAt: 'desc' }
    });

    res.status(200).json({
      scannedMessages,
      newMessages,
      extractedUrls,
      newEvents,
      newUniqueListings,
      recentUniqueListings
    });
  } catch (err) {
    console.error('ingest error', err);
    res.status(500).json({ error: (err as Error).message });
  }
}
