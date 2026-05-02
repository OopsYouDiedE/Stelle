import { z } from "zod";
import { ok, sideEffects } from "./types.js";
import type { ToolDefinition } from "./types.js";
import { validatePublicHttpUrl } from "./security.js";

export function createSearchTools(): ToolDefinition[] {
  return [
    {
      name: "search.web_search",
      title: "Web Search",
      description: "Search public web pages.",
      authority: "network_read",
      inputSchema: z.object({ query: z.string().min(1), count: z.number().int().min(1).max(10).optional().default(5) }),
      sideEffects: sideEffects({ networkAccess: true, consumesBudget: true }),
      async execute(input) {
        const results = await duckDuckGoHtmlSearch(input.query, input.count);
        return ok(`Found ${results.length} web result(s).`, { query: input.query, results });
      },
    },
    {
      name: "search.web_read",
      title: "Web Read",
      description: "Fetch a public HTTP(S) page.",
      authority: "network_read",
      inputSchema: z.object({
        url: z.string().url(),
        max_chars: z.number().int().min(500).max(50000).optional().default(8000),
      }),
      sideEffects: sideEffects({ networkAccess: true, consumesBudget: true }),
      async execute(input) {
        const url = new URL(input.url);
        const blocked = await validatePublicHttpUrl(url);
        if (blocked) return blocked;
        const response = await fetchPublicUrl(url);
        if (!response.ok) throw new Error(`web_read failed: ${response.status}`);
        const raw = await response.text();
        const text = htmlToText(raw);
        return ok(`Read ${Math.min(input.max_chars, text.length)} chars from ${response.url}.`, {
          url: response.url,
          text: text.slice(0, input.max_chars),
          length: text.length,
        });
      },
    },
  ];
}

async function duckDuckGoHtmlSearch(query: string, count: number): Promise<any[]> {
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", query);

  // DDG's HTML endpoint behaves more reliably when the tool presents a browser-like request.
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
  });

  if (!response.ok) throw new Error(`DDG search failed: ${response.status}`);
  const html = await response.text();

  const results: any[] = [];
  const resultRegex =
    /<a class="result__a" rel="noopener" href="([^"]+)">([^<]+)<\/a>.*?<a class="result__snippet"[^>]*>([^<]+)<\/a>/gs;

  let match;
  while ((match = resultRegex.exec(html)) !== null && results.length < count) {
    const rawUrl = match[1];
    const title = match[2].trim();
    const snippet = match[3].trim();
    const finalUrl = normalizeDuckDuckGoUrl(rawUrl);
    if (finalUrl) {
      results.push({ title, url: finalUrl, snippet });
    }
  }

  return results;
}

async function fetchPublicUrl(url: URL): Promise<Response> {
  let current = url;
  for (let i = 0; i <= 5; i++) {
    const blocked = await validatePublicHttpUrl(current);
    if (blocked) throw new Error(blocked.summary);

    const response = await fetch(current, {
      headers: { "User-Agent": "Stelle/1.0 (Bot; Research-Agent)" },
      redirect: "manual",
    });

    if (![301, 302, 303, 307, 308].includes(response.status)) return response;

    const location = response.headers.get("location");
    if (!location) return response;
    current = new URL(location, current);
  }
  throw new Error("Too many redirects.");
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, "")
    .replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDuckDuckGoUrl(rawUrl: string): string | null {
  if (rawUrl.startsWith("http")) return rawUrl;
  try {
    const u = new URL(rawUrl, "https://duckduckgo.com");
    return u.searchParams.get("uddg");
  } catch {
    return null;
  }
}
