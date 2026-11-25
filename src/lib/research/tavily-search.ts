export interface WebEvidence {
  url: string;
  title?: string;
  excerpt?: string;
  publishedAt?: string;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)));
}

function cleanText(value: string): string {
  return decodeHtml(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function resolveResultUrl(raw: string): string | null {
  try {
    const url = new URL(decodeHtml(raw), "https://html.duckduckgo.com");
    if (url.hostname.endsWith("duckduckgo.com") && url.pathname === "/l/") {
      const destination = url.searchParams.get("uddg");
      if (!destination) return null;
      return new URL(destination).toString();
    }
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.toString();
  } catch { return null; }
}

/**
 * No-key web search fallback. Uses DuckDuckGo's public HTML results page;
 * no Tavily credentials or usage quota are required.
 */
export async function searchBusinessWeb(
  query: string,
  _unusedApiKey?: string,
  _country?: string,
  fetcher: typeof fetch = fetch,
): Promise<WebEvidence[]> {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length > 600) throw new Error("Search query must contain 1–600 characters.");
  const searchUrl = new URL("https://html.duckduckgo.com/html/");
  searchUrl.searchParams.set("q", trimmed);
  const response = await fetcher(searchUrl.toString(), {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "Mozilla/5.0 (compatible; SamzyProspectDiscovery/1.0; +https://samzytech.name.ng)",
    },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (!response.ok) {
    console.error("[web-search] DuckDuckGo rejected request", { status: response.status });
    throw new Error(`Web search HTTP ${response.status}`);
  }
  const html = await response.text();
  if (/anomaly|captcha|bot challenge|unusual traffic/i.test(html) && !/result__a/.test(html)) {
    throw new Error("DuckDuckGo returned a bot challenge instead of search results.");
  }
  const results: WebEvidence[] = [];
  // Result anchors/snippets are parsed independently to tolerate DDG markup changes.
  const anchors = [...html.matchAll(/<a[^>]*class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  for (const anchor of anchors) {
    const url = resolveResultUrl(anchor[1]);
    const title = cleanText(anchor[2]);
    if (!url || !title) continue;
    const start = anchor.index ?? 0;
    const tail = html.slice(start, start + 5000);
    const snippetMatch = tail.match(/class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\//i);
    const excerpt = snippetMatch ? cleanText(snippetMatch[1]) : "";
    if (results.some((item) => item.url === url)) continue;
    results.push({ url, title: title.slice(0, 300), ...(excerpt ? { excerpt: excerpt.slice(0, 2000) } : {}) });
    if (results.length >= 10) break;
  }
  if (!results.length) {
    console.warn("[web-search] DuckDuckGo returned no parseable results", { responseBytes: html.length });
    throw new Error("Web search returned no parseable business results.");
  }
  console.info("[web-search] search succeeded", { provider: "DuckDuckGo HTML", resultCount: results.length });
  return results;
}
