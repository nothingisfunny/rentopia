import type { VercelRequest, VercelResponse } from '@vercel/node';
import { google } from 'googleapis';
import prisma from '../lib/prisma.js';
import { canonicalizeUrl, hashUrl } from '../lib/canonicalize.js';
import { extractUrls, extractFirstImage, stripHtml, extractListingsFromHtml } from '../lib/extract.js';
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

  const isBackfill = String(req.query.backfill || '').toLowerCase() === 'true';
  const backfillSecret = process.env.BACKFILL_SECRET;
  if (isBackfill) {
    if (!backfillSecret || req.query.secret !== backfillSecret) {
      res.status(401).json({ error: 'Unauthorized backfill' });
      return;
    }
  }
  const sinceMs = req.query.sinceMs ? Number(req.query.sinceMs) : null;
  const sinceDate = sinceMs ? new Date(sinceMs) : null;
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || 'unknown';

  if (!isBackfill) {
    try {
      await enforceRateLimit(ip, 30);
    } catch (err) {
      res.status(429).json({ error: (err as Error).message });
      return;
    }
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
    const clauses = ['from:(alerts@alerts.craigslist.org)'];
    if (sinceDate && !isNaN(sinceDate.getTime())) {
      const yyyy = sinceDate.getUTCFullYear();
      const mm = String(sinceDate.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(sinceDate.getUTCDate()).padStart(2, '0');
      clauses.push(`after:${yyyy}/${mm}/${dd}`);
    }
    const query = clauses.join(' ');
    let pageToken: string | undefined = undefined;
    const messages: { id: string }[] = [];
    const maxPages = isBackfill ? 20 : 1; // up to ~1000 messages in backfill; otherwise just newest batch
    const maxResults = isBackfill ? 50 : 5;

    for (let page = 0; page < maxPages; page++) {
      const resList = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults,
        pageToken
      });
      const batch = resList.data.messages || [];
      console.log('[ingest] gmail page %s returned %s msgs', page + 1, batch.length);
      messages.push(...batch);
      pageToken = resList.data.nextPageToken || undefined;
      if (!pageToken || !isBackfill) break;
    }

    const scannedMessages = messages.length;
    const ids = Array.from(new Set(messages.map((m) => m.id!).filter(Boolean)));

    console.log('[ingest] messages=%s', scannedMessages);

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
      const { src: firstImage, title: imageTitle } = extractFirstImage(html);
      const description =
        plain?.trim().slice(0, 500) ||
        stripHtml(html).trim().slice(0, 500) ||
        imageTitle ||
        null;
      const craigslistListings = extractListingsFromHtml(html)
        .filter((l) => l.url.includes('craigslist.org') && l.url.includes('/apa/'));
      const clMap = new Map<string, { title: string | null; price: number | null; image: string | null; description: string | null }>();
      for (const cl of craigslistListings) {
        const canonical = canonicalizeUrl(cl.url);
        if (!canonical) continue;
        clMap.set(canonical, {
          title: cl.text,
          price: cl.price,
          image: cl.image,
          description: cl.description
        });
      }

      // If we have parsed Craigslist anchors, use only those; otherwise fallback to generic URL extraction.
      const targetUrls = clMap.size
        ? Array.from(clMap.keys())
        : extractUrls(plain, html).map((u) => canonicalizeUrl(u)).filter((u): u is string => Boolean(u));

      extractedUrls += targetUrls.length;

      for (const canonical of targetUrls) {
        const urlObj = new URL(canonical);
        const source = classifySource(urlObj);
        if (source !== 'craigslist') continue; // only craigslist
        if (!urlObj.pathname.includes('/apa')) continue; // only apts
        const urlHash = hashUrl(canonical);

        const clDetails = clMap.get(canonical);
        const { price: subjPrice, title: parsedTitle } = parseCraigslistSubject(subject || plain);
        const price = clDetails?.price ?? subjPrice;
        const chosenImage = clDetails?.image || firstImage;
        const chosenTitle = clDetails?.description || clDetails?.title || parsedTitle || subject || plain.slice(0, 140) || null;
        const chosenDesc = clDetails?.description || description || null;

        const existingListing = await prisma.listing.findUnique({ where: { urlHash } });
        let listingId: string;
        if (existingListing) {
          await prisma.listing.update({
            where: { urlHash },
            data: {
              latestSeenAt: receivedAt,
              ...(price && !existingListing.price ? { price } : {}),
              ...(chosenImage && !existingListing.thumbnailUrl ? { thumbnailUrl: chosenImage } : {}),
              ...(description && !existingListing.description ? { description } : {}),
              ...(chosenTitle && !existingListing.title ? { title: chosenTitle } : {})
            }
          });
          listingId = existingListing.id;
        } else {
          const created = await prisma.listing.create({
            data: {
              url: canonical,
              urlHash,
              source,
              title: chosenTitle,
              description: chosenDesc,
              price,
              thumbnailUrl: chosenImage,
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
      orderBy: { latestSeenAt: 'desc' },
      take: 200
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
