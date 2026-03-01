const URL_REGEX = /(https?:\/\/[^\s"'<>]+)/gi;
const IMG_REGEX = /<img[^>]+src=["']([^"']+)["'][^>]*?(?:title=["']([^"']+)["'])?/i;
const TD_BG_REGEX = /<td[^>]+background=["']([^"']+)["']/i;
const TR_BG_REGEX = /<tr[^>]+background=["']([^"']+)["']/i;
const STYLE_BG_REGEX = /background-image\s*:\s*url\(["']?([^"')]+)["']?\)/i;
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
  const imgMatch = IMG_REGEX.exec(html);
  const bgMatch = TD_BG_REGEX.exec(html);
  const trBgMatch = TR_BG_REGEX.exec(html);
  const styleBgMatch = STYLE_BG_REGEX.exec(html);
  if (!imgMatch && !bgMatch && !styleBgMatch && !trBgMatch) return { src: null, title: null };

  let src = imgMatch ? imgMatch[1] : bgMatch ? bgMatch[1] : trBgMatch ? trBgMatch[1] : styleBgMatch ? styleBgMatch[1] : null;
  const title = imgMatch ? imgMatch[2] || null : null;

  // Gmail proxy URLs sometimes embed the real URL after a '#'
  const hashIdx = src?.indexOf('#') ?? -1;
  if (hashIdx !== -1 && src) {
    const candidate = src.slice(hashIdx + 1);
    if (candidate.startsWith('http')) src = candidate;
  }
  // Prefer raw craigslist image if present in the string
  const clMatch = src?.match(/(https?:\/\/images\.craigslist\.org\/[^\s"']+)/);
  if (clMatch) src = clMatch[1];
  // Prefer Zillow photos if present in the string
  const ziMatch = src?.match(/(https?:\/\/photos\.zillowstatic\.com\/[^\s"']+)/);
  if (ziMatch) src = ziMatch[1];
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
    const blockText = stripHtml(blockHtml).replace(BR_TAG_REGEX, ' ').replace(/\s+/g, ' ').trim();
    let match: RegExpExecArray | null;
    while ((match = ANCHOR_REGEX.exec(blockHtml)) !== null) {
      const href = match[1];
      const anchorHtml = match[2] || '';
      const textRaw = stripHtml(anchorHtml.replace(BR_TAG_REGEX, ' ')).trim();
      if (/new results/i.test(textRaw)) continue; // skip digest summary anchors
      const text = textRaw || blockText || null;

      // Price from the surrounding <p> block
      const blockPrice = blockHtml.match(PRICE_REGEX);
      const price = blockPrice ? Number(blockPrice[1].replace(/,/g, '')) : null;

      // Image from the same block if present
      const img = extractFirstImage(blockHtml).src;

      // Description from the stripped block text (without the anchor itself)
      const desc = stripHtml(blockHtml.replace(anchorHtml, '')).replace(BR_TAG_REGEX, ' ').replace(/\s+/g, ' ').trim();

      // Derive structured bits for Zillow-style content
      const bedsMatch = blockText.match(/(\d+(?:\.\d+)?)\s*(?:bd|br|bed)/i);
      const bathsMatch = blockText.match(/(\d+(?:\.\d+)?)\s*ba/i);
      const addressMatch = blockText.match(/\d{3,}[^,]+,\s*[^,]+,\s*[A-Z]{2}\s*\d{5}/);
      const derivedParts = [
        price ? `$${price.toLocaleString()}` : null,
        bedsMatch ? `${bedsMatch[1]} br` : null,
        bathsMatch ? `${bathsMatch[1]} ba` : null,
        addressMatch ? addressMatch[0] : null
      ].filter(Boolean);
      const derivedDesc = derivedParts.join(' • ');

      const cleanText = text && /new results/i.test(text) ? null : text;

      // Skip anchors with no meaningful info (likely footer)
      if (!price && !bedsMatch && !addressMatch) continue;

      listings.push({
        url: href,
        text: cleanText,
        price,
        image: img,
        description: derivedDesc || desc || text || null
      });
    }
  }

  return listings;
}
