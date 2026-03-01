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
  description: string | null;
}

export function extractListingsFromHtml(html: string): HtmlListing[] {
  const listings: HtmlListing[] = [];

  // Break into <p> blocks to keep context (price + img + title together)
  const pBlocks = html.split(/<\/p>/i);
  for (const block of pBlocks) {
    const blockHtml = block + '</p>';
    let match: RegExpExecArray | null;
    while ((match = ANCHOR_REGEX.exec(blockHtml)) !== null) {
      const href = match[1];
      const anchorHtml = match[2] || '';
      const textRaw = stripHtml(anchorHtml.replace(BR_TAG_REGEX, ' ')).trim();
      if (/new results/i.test(textRaw)) continue; // skip digest summary anchors
      const text = textRaw || null;

      // Price from the surrounding <p> block
      const blockPrice = blockHtml.match(PRICE_REGEX);
      const price = blockPrice ? Number(blockPrice[1].replace(/,/g, '')) : null;

      // Image from the same block if present
      const img = extractFirstImage(blockHtml).src;

      // Description from the stripped block text (without the anchor itself)
      const desc = stripHtml(blockHtml.replace(anchorHtml, '')).replace(BR_TAG_REGEX, ' ').trim();

      const cleanText = text && /new results/i.test(text) ? null : text;

      listings.push({
        url: href,
        text: cleanText,
        price,
        image: img,
        description: desc || text || null
      });
    }
  }

  return listings;
}
