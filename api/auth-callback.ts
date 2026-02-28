import type { VercelRequest, VercelResponse } from '@vercel/node';
import { google } from 'googleapis';
import prisma from '../lib/prisma.js';
import { getOAuthClient, getProfileEmail } from '../lib/gmail.js';
import { applyCors } from '../lib/cors.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res, ['GET'])) return;

  if (req.method !== 'GET') {
    res.status(405).send('Method not allowed');
    return;
  }

  const code = req.query.code as string | undefined;
  if (!code) {
    res.status(400).send('Missing code');
    return;
  }

  try {
    const client = getOAuthClient();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    const email = await getProfileEmail(client);
    const expiryDate = tokens.expiry_date ? BigInt(tokens.expiry_date) : null;

    await prisma.oAuthToken.upsert({
      where: { email },
      update: {
        refreshToken: tokens.refresh_token || undefined,
        accessToken: tokens.access_token || null,
        expiryDate
      },
      create: {
        email,
        refreshToken: tokens.refresh_token || '',
        accessToken: tokens.access_token || null,
        expiryDate
      }
    });

    const appOrigin = process.env.APP_ORIGIN || '/';
    const redirectTo = `${appOrigin}?auth=success&email=${encodeURIComponent(email)}`;
    res.writeHead(302, { Location: redirectTo });
    res.end();
  } catch (err) {
    console.error('auth-callback error', err);
    const appOrigin = process.env.APP_ORIGIN || '/';
    const redirectTo = `${appOrigin}?auth=error`;
    res.writeHead(302, { Location: redirectTo });
    res.end();
  }
}
