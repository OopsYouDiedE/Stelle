import type { ToolDefinition } from "../../agent/types.js";

interface WebSearchParams {
  query: string;
  count?: number;
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

function containsCjk(text: string): boolean {
  return /[\u3400-\u9fff]/.test(text);
}

async function serpApiSearchWithEngine(
  query: string,
  count: number,
  apiKey: string,
  engine: string
): Promise<SearchResult[]> {
  const engineDefaults =
    engine === "baidu"
      ? { hl: "zh-cn", gl: "cn" }
      : { hl: process.env.SERPAPI_HL ?? "zh-cn", gl: process.env.SERPAPI_GL ?? "cn" };

  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", engine);
  url.searchParams.set("q", query);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("num", String(Math.min(Math.max(count, 1), 20)));
  url.searchParams.set("hl", engineDefaults.hl);
  url.searchParams.set("gl", engineDefaults.gl);

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`SerpApi Search failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as any;
  if (data.error) {
    if (String(data.error).toLowerCase().includes("hasn't returned any results")) {
      return [];
    }
    throw new Error(`SerpApi Search failed: ${data.error}`);
  }

  const organic = (data.organic_results ?? []).map((item: any) => ({
    title: item.title ?? "",
    url: item.link ?? item.url ?? "",
    snippet: item.snippet ?? item.rich_snippet?.top?.detected_extensions?.join?.(", ") ?? "",
    source: `serpapi_${engine}`,
  }));

  const news = (data.news_results ?? []).map((item: any) => ({
    title: item.title ?? "",
    url: item.link ?? "",
    snippet: item.snippet ?? item.source ?? "",
    source: `serpapi_${engine}_news`,
  }));

  return [...organic, ...news]
    .filter((item: SearchResult) => item.title && item.url)
    .slice(0, count);
}

async function serpApiSearch(query: string, count: number): Promise<SearchResult[]> {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) return [];

  const configuredEngine = process.env.SERPAPI_ENGINE ?? "google";
  const primary = await serpApiSearchWithEngine(query, count, apiKey, configuredEngine);
  if (primary.length || !containsCjk(query) || configuredEngine === "baidu") {
    return primary;
  }

  return serpApiSearchWithEngine(query, count, apiKey, "baidu");
}

async function braveSearch(query: string, count: number): Promise<SearchResult[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) return [];
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(Math.min(Math.max(count, 1), 20)));
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
  });
  if (!response.ok) {
    throw new Error(`Brave Search failed: ${response.status} ${response.statusText}`);
  }
  const data = (await response.json()) as any;
  return (data.web?.results ?? []).map((item: any) => ({
    title: item.title ?? "",
    url: item.url ?? "",
    snippet: item.description ?? "",
    source: "brave",
  }));
}

async function tavilySearch(query: string, count: number): Promise<SearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return [];
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: Math.min(Math.max(count, 1), 20),
      search_depth: "basic",
    }),
  });
  if (!response.ok) {
    throw new Error(`Tavily Search failed: ${response.status} ${response.statusText}`);
  }
  const data = (await response.json()) as any;
  return (data.results ?? []).map((item: any) => ({
    title: item.title ?? "",
    url: item.url ?? "",
    snippet: item.content ?? "",
    source: "tavily",
  }));
}

async function duckDuckGoInstantAnswer(query: string, count: number): Promise<SearchResult[]> {
  const url = new URL("https://api.duckduckgo.com/");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("no_html", "1");
  url.searchParams.set("skip_disambig", "1");
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`DuckDuckGo fallback failed: ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  if (!text.trim()) return [];
  const data = JSON.parse(text) as any;
  const results: SearchResult[] = [];
  const collect = (items: any[]) => {
    for (const item of items) {
      if (item.FirstURL) {
        results.push({
          title: item.Text?.split(" - ")[0] ?? item.FirstURL,
          url: item.FirstURL,
          snippet: item.Text ?? "",
          source: "duckduckgo_instant_answer",
        });
      }
      if (Array.isArray(item.Topics)) collect(item.Topics);
    }
  };
  collect(data.RelatedTopics ?? []);
  if (data.AbstractURL) {
    results.unshift({
      title: data.Heading ?? data.AbstractURL,
      url: data.AbstractURL,
      snippet: data.AbstractText ?? "",
      source: "duckduckgo_instant_answer",
    });
  }
  return results.slice(0, count);
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function normalizeDuckDuckGoUrl(rawUrl: string): string | null {
  let url = decodeHtmlEntities(rawUrl);
  const redirect = url.match(/[?&]uddg=([^&]+)/);
  if (redirect) url = decodeURIComponent(redirect[1]);

  if (
    url.includes("duckduckgo.com/y.js") ||
    url.includes("bing.com/aclick") ||
    url.includes("/aclick?")
  ) {
    return null;
  }

  return url;
}

async function duckDuckGoHtmlSearch(query: string, count: number): Promise<SearchResult[]> {
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", query);
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
    },
  });
  if (!response.ok) {
    throw new Error(`DuckDuckGo HTML fallback failed: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const results: SearchResult[] = [];
  const blocks = html.split(/<div class="result[\s"]/i).slice(1);

  for (const block of blocks) {
    const linkMatch = block.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;
    const snippetMatch = block.match(/<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    const url = normalizeDuckDuckGoUrl(linkMatch[1]);
    if (!url) continue;
    results.push({
      title: stripTags(linkMatch[2]),
      url,
      snippet: snippetMatch ? stripTags(snippetMatch[1]) : "",
      source: "duckduckgo_html",
    });
    if (results.length >= count) break;
  }

  return results;
}

async function firstSuccessfulSearch(
  query: string,
  limit: number
): Promise<SearchResult[]> {
  const providers = [
    serpApiSearch,
    braveSearch,
    tavilySearch,
    duckDuckGoInstantAnswer,
    duckDuckGoHtmlSearch,
  ];
  const errors: string[] = [];

  for (const provider of providers) {
    try {
      const results = await provider(query, limit);
      if (results.length) return results;
    } catch (error) {
      errors.push((error as Error).message);
    }
  }

  if (errors.length) {
    throw new Error(`All web search providers failed: ${errors.join("; ")}`);
  }
  return [];
}

const webSearchTool: ToolDefinition<WebSearchParams> = {
  schema: {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the public web for source URLs and snippets. Uses SerpApi first when configured, then Brave/Tavily, with a lightweight DuckDuckGo fallback.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query.",
          },
          count: {
            type: "integer",
            description: "Maximum number of results. Default 5.",
          },
        },
        required: ["query"],
      },
    },
  },
  async execute({ query, count = 5 }) {
    const limit = Math.min(Math.max(count, 1), 20);
    const finalResults = await firstSuccessfulSearch(query, limit);
    return JSON.stringify({ query, results: finalResults.slice(0, limit) }, null, 2);
  },
};

export default webSearchTool;
