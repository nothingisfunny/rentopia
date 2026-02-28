const URL_REGEX = /(https?:\/\/[^\s"'<>]+)/gi;
const IMG_REGEX = /<img[^>]+src=["']([^"']+)["'][^>]*?(?:title=["']([^"']+)["'])?/i;
const ANCHOR_REGEX = /<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis;
const PRICE_REGEX = /\$([\d,]+)/;
const BR_TAG_REGEX = /<br\s*\/?>/gi;

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ');
}

export function extractUrls(textPlain: string, textHtml: string): string[] {
  const urls = new Set<string>();
  const scan = (body: string) => {
    let match: RegExpExecArray | null;
    while ((match = URL_REGEX.exec(body)) !== null) {
      urls.add(match[1]);
    }
  };

  if (textPlain) scan(textPlain);
  if (textHtml) scan(stripHtml(textHtml));
  return Array.from(urls);
}

export function extractFirstImage(html: string): { src: string | null; title: string | null } {
  const match = IMG_REGEX.exec(html);
  if (!match) return { src: null, title: null };
  let src = match[1];
  const title = match[2] || null;
  // Gmail proxy URLs sometimes embed the real URL after a '#'
  const hashIdx = src.indexOf('#');
  if (hashIdx !== -1) {
    const candidate = src.slice(hashIdx + 1);
    if (candidate.startsWith('http')) src = candidate;
  }
  // Prefer raw craigslist image if present in the string
  const clMatch = src.match(/(https?:\/\/images\.craigslist\.org\/[^\s"']+)/);
  if (clMatch) src = clMatch[1];
  return { src, title };
}

export { stripHtml };

export interface HtmlListing {
  url: string;
  text: string | null;
  price: number | null;
  image: string | null;
  rawHtml: string | null;
}

export function extractListingsFromHtml(html: string): HtmlListing[] {
  const listings: HtmlListing[] = [];
  let match: RegExpExecArray | null;
  while ((match = ANCHOR_REGEX.exec(html)) !== null) {
    const href = match[1];
    const anchorHtml = match[2] || '';
    const text = stripHtml(anchorHtml.replace(BR_TAG_REGEX, ' ')).trim() || null;

    // Price: look in anchor text or nearby preceding chars
    const before = html.slice(Math.max(0, match.index - 120), match.index);
    const priceMatch = anchorHtml.match(PRICE_REGEX) || before.match(PRICE_REGEX);
    const price = priceMatch ? Number(priceMatch[1].replace(/,/g, '')) : null;

    // Image: look ahead within next 400 chars
    const ahead = html.slice(match.index, match.index + 400);
    const img = extractFirstImage(ahead).src;

    listings.push({ url: href, text, price, image: img, rawHtml: anchorHtml });
  }
  return listings;
}
