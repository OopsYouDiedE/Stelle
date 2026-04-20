import type { ToolDefinition } from "../../agent/types.js";

interface WebReadParams {
  url: string;
  max_chars?: number;
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

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return null;
  return decodeHtmlEntities(match[1].replace(/\s+/g, " ").trim());
}

function htmlToReadableText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|section|article|header|footer|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

const webReadTool: ToolDefinition<WebReadParams> = {
  schema: {
    type: "function",
    function: {
      name: "web_read",
      description:
        "Fetch a public URL and return a compact readable text extract. Use after web_search when the source page content is needed.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "Absolute public URL to fetch.",
          },
          max_chars: {
            type: "integer",
            description: "Maximum characters to return. Default 8000.",
          },
        },
        required: ["url"],
      },
    },
  },
  async execute({ url, max_chars = 8000 }) {
    const limit = Math.min(Math.max(max_chars, 1000), 30000);
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      throw new Error(`web_read failed: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    const raw = await response.text();
    const title = contentType.includes("html") ? extractTitle(raw) : null;
    const text = contentType.includes("html") ? htmlToReadableText(raw) : raw.trim();
    const clipped = text.slice(0, limit);

    return JSON.stringify(
      {
        url: response.url,
        title,
        contentType,
        text: clipped,
        length: text.length,
        truncated: text.length > clipped.length,
      },
      null,
      2
    );
  },
};

export default webReadTool;
