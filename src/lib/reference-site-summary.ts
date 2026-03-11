const FETCH_TIMEOUT_MS = Number(process.env.REFERENCE_SITE_FETCH_TIMEOUT_MS ?? "6000");
const MAX_HTML_BYTES = Number(process.env.REFERENCE_SITE_MAX_HTML_BYTES ?? "200000");
const CACHE_TTL_MS = Number(process.env.REFERENCE_SITE_CACHE_TTL_MS ?? "900000");
const MAX_SUMMARY_CHARS = 420;

const STOPWORDS = new Set([
  "a", "about", "all", "an", "and", "are", "as", "at", "be", "by", "can", "for",
  "from", "get", "has", "have", "in", "is", "it", "its", "of", "on", "or", "our",
  "that", "the", "their", "they", "this", "to", "we", "with", "your", "you",
]);

const cache = new Map<string, { expiresAt: number; value: ReferenceSeoSummary }>();

export interface ReferenceSeoSummary {
  domain: string;
  summary: string;
  keywords: string[];
  sourceUrl: string;
}

function truncate(input: string, maxChars: number): string {
  if (input.length <= maxChars) return input;
  return `${input.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function stripHtml(input: string): string {
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTagContent(html: string, tag: string): string | null {
  const match = html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!match?.[1]) return null;
  const value = stripHtml(match[1]).trim();
  return value || null;
}

function extractMetaContent(html: string, name: string): string | null {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const direct = html.match(
    new RegExp(
      `<meta[^>]+(?:name|property)=["']${escapedName}["'][^>]*content=["']([^"']+)["'][^>]*>`,
      "i",
    ),
  );
  if (direct?.[1]?.trim()) return stripHtml(direct[1].trim());
  const reverse = html.match(
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]*(?:name|property)=["']${escapedName}["'][^>]*>`,
      "i",
    ),
  );
  if (reverse?.[1]?.trim()) return stripHtml(reverse[1].trim());
  return null;
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (
    host.includes(":") &&
    (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd"))
  ) {
    return true;
  }
  return isPrivateIpv4(host);
}

function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function normalizeReferenceDomain(input: string): { domain: string; url: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) return null;
  if (!parsed.hostname || !parsed.hostname.includes(".")) return null;
  if (isBlockedHost(parsed.hostname)) return null;
  return {
    domain: parsed.hostname.toLowerCase(),
    url: `${parsed.protocol}//${parsed.hostname}`,
  };
}

async function fetchHtmlWithCap(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "DomainsearchBot/1.0 (+https://domainsearch.local)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("text/html")) return null;
    const reader = response.body?.getReader();
    if (!reader) {
      const text = await response.text();
      return text.slice(0, MAX_HTML_BYTES);
    }

    let bytes = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const remaining = MAX_HTML_BYTES - bytes;
      if (remaining <= 0) break;
      const nextChunk = value.length > remaining ? value.slice(0, remaining) : value;
      chunks.push(nextChunk);
      bytes += nextChunk.length;
      if (bytes >= MAX_HTML_BYTES) break;
    }
    return new TextDecoder().decode(concatUint8Arrays(chunks));
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function extractKeywords(seed: string): string[] {
  const words = seed
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));

  const counts = new Map<string, number>();
  for (const word of words) {
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([word]) => word);
}

function buildSummary(parts: {
  domain: string;
  title: string | null;
  metaDescription: string | null;
  h1: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  introText: string | null;
  keywords: string[];
}): string {
  const positioning = parts.metaDescription || parts.ogDescription || parts.introText || "";
  const headline = parts.h1 || parts.ogTitle || parts.title || "";
  const keywordLine = parts.keywords.length
    ? `SEO signals: ${parts.keywords.join(", ")}.`
    : "";

  return truncate(
    [
      `Reference site: ${parts.domain}.`,
      headline ? `Headline theme: ${truncate(headline, 110)}.` : "",
      positioning ? `Positioning summary: ${truncate(positioning, 180)}.` : "",
      keywordLine,
    ]
      .filter(Boolean)
      .join(" "),
    MAX_SUMMARY_CHARS,
  );
}

export async function summarizeReferenceDomain(
  referenceDomain: string,
): Promise<ReferenceSeoSummary | null> {
  const normalized = normalizeReferenceDomain(referenceDomain);
  if (!normalized) return null;

  const cached = cache.get(normalized.domain);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const candidates = [normalized.url, `http://${normalized.domain}`];
  let html: string | null = null;
  let resolvedUrl = normalized.url;
  for (const url of candidates) {
    html = await fetchHtmlWithCap(url);
    if (html) {
      resolvedUrl = url;
      break;
    }
  }
  if (!html) return null;

  const title = extractTagContent(html, "title");
  const h1 = extractTagContent(html, "h1");
  const metaDescription = extractMetaContent(html, "description");
  const ogTitle = extractMetaContent(html, "og:title");
  const ogDescription = extractMetaContent(html, "og:description");
  const body = extractTagContent(html, "body");
  const introText = body ? truncate(body, 240) : null;

  const keywords = extractKeywords(
    [title, h1, metaDescription, ogTitle, ogDescription, introText].filter(Boolean).join(" "),
  );
  const summary = buildSummary({
    domain: normalized.domain,
    title,
    metaDescription,
    h1,
    ogTitle,
    ogDescription,
    introText,
    keywords,
  });
  if (!summary.trim()) return null;

  const value: ReferenceSeoSummary = {
    domain: normalized.domain,
    summary,
    keywords,
    sourceUrl: resolvedUrl,
  };
  cache.set(normalized.domain, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  return value;
}
