// Plain-text MIME part is a spam/deliverability/accessibility signal —
// mail-tester flagged ours as a stub ("Please view this email in an HTML
// compatible client."). Derives a readable text alternative from our own
// HTML instead, since every template we send is built from a small, known
// set of helpers (emailShell.ts) rather than arbitrary markup.
const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};

function decodeEntities(html: string): string {
  return html.replace(/&(nbsp|amp|lt|gt|quot|#39|apos);/g, (m) => ENTITIES[m] ?? m);
}

export function htmlToPlainText(html: string): string {
  if (!html) return "";

  let text = html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    // Links: keep the visible text and the URL, e.g. "Set Password (https://...)"
    .replace(/<a\s+[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, label) => {
      const cleanLabel = label.replace(/<[^>]+>/g, "").trim();
      return href && cleanLabel && !cleanLabel.includes(href) ? `${cleanLabel} (${href})` : (cleanLabel || href);
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|table|h[1-6])>/gi, "\n\n")
    .replace(/<\/td>/gi, "  ")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "");

  text = decodeEntities(text);

  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
