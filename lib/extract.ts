const URL_REGEX = /(https?:\/\/[^\s"'<>]+)/gi;
const IMG_REGEX = /<img[^>]+src=["']([^"']+)["'][^>]*?(?:title=["']([^"']+)["'])?/i;

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
