const URL_REGEX = /(https?:\/\/[^\s"'<>]+)/gi;
const IMG_REGEX = /<img[^>]+src=["']([^"']+)["']/i;

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

export function extractFirstImage(html: string): string | null {
  const match = IMG_REGEX.exec(html);
  return match ? match[1] : null;
}
