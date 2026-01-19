#!/usr/bin/env node

/**
 * DevExpress ASP.NET Bootstrap Documentation MCP Server
 * 
 * This server crawls and indexes the DevExpress ASP.NET Bootstrap documentation,
 * providing fast local search capabilities for code generation assistance.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import * as cheerio from "cheerio";
import MiniSearch from "minisearch";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// =============================================================================
// TYPES AND INTERFACES
// =============================================================================

/** Represents an indexed documentation page */
interface IndexedPage {
  /** Unique ID for MiniSearch (URL hash) */
  id: string;
  /** Full URL of the page */
  url: string;
  /** Page title (from og:title or <title>) */
  title: string;
  /** Array of h1/h2/h3 headings */
  headings: string[];
  /** Main text content (cleaned) */
  text: string;
  /** Code blocks from <pre> elements */
  codeBlocks: string[];
  /** ISO timestamp when page was fetched */
  fetchedAt: string;
}

/** Metadata about the crawl/index state */
interface IndexMeta {
  /** Start URL used for crawling */
  startUrl: string;
  /** Maximum pages setting */
  maxPages: number;
  /** Delay between requests in ms */
  delayMs: number;
  /** Total pages successfully indexed */
  indexedCount: number;
  /** Total URLs visited (including failures) */
  visitedCount: number;
  /** Number of failed fetches */
  failureCount: number;
  /** ISO timestamp of last refresh */
  lastRefresh: string;
  /** Allowed host for crawling */
  allowedHost: string;
  /** Allowed path prefix for crawling */
  allowedPathPrefix: string;
}

/** Search result from MiniSearch */
interface SearchResult {
  id: string;
  score: number;
  match: Record<string, string[]>;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Data directory - relative to project root
const PROJECT_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(PROJECT_ROOT, "data");
const PAGES_FILE = path.join(DATA_DIR, "pages.json");
const META_FILE = path.join(DATA_DIR, "meta.json");

// Default crawl settings
const DEFAULT_START_URL = "https://docs.devexpress.com/AspNetBootstrap/117864/aspnet-bootstrap-controls";
const DEFAULT_MAX_PAGES = 800;
const DEFAULT_DELAY_MS = 200;

// Security constraints
const ALLOWED_HOST = "docs.devexpress.com";
const ALLOWED_PATH_PREFIX = "/AspNetBootstrap/";

// =============================================================================
// GLOBAL STATE
// =============================================================================

/** In-memory array of indexed pages */
let indexedPages: IndexedPage[] = [];

/** MiniSearch instance for fast full-text search */
let searchIndex: MiniSearch<IndexedPage> | null = null;

/** Current metadata */
let indexMeta: IndexMeta | null = null;

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Log a message to stderr (NOT stdout, which is reserved for MCP protocol)
 */
function logDebug(message: string): void {
  process.stderr.write(`[DevExpress MCP] ${message}\n`);
}

/**
 * Ensure the data directory exists
 */
function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Normalize a URL by removing hash fragments and query strings
 */
function normalizeUrl(urlString: string): string {
  try {
    const url = new URL(urlString);
    // Remove hash and search params
    url.hash = "";
    url.search = "";
    // Ensure no trailing slash for consistency (except for root)
    let normalized = url.href;
    if (normalized.endsWith("/") && url.pathname !== "/") {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  } catch {
    return urlString;
  }
}

/**
 * Check if a URL is within the allowed domain and path
 */
function isAllowedUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return (
      url.host === ALLOWED_HOST &&
      url.pathname.startsWith(ALLOWED_PATH_PREFIX)
    );
  } catch {
    return false;
  }
}

/**
 * Create a simple hash from a string (for page IDs)
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Sleep for a specified number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a short snippet from text
 */
function createSnippet(text: string, maxLength: number = 300): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  return cleaned.slice(0, maxLength - 3) + "...";
}

// =============================================================================
// CRAWLER FUNCTIONS
// =============================================================================

/**
 * Fetch a single page and extract content
 */
async function fetchAndParse(url: string): Promise<IndexedPage | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "DevExpress-MCP-Crawler/1.0 (Documentation Indexer)",
        "Accept": "text/html,application/xhtml+xml",
      },
    });

    if (!response.ok) {
      logDebug(`Failed to fetch ${url}: HTTP ${response.status}`);
      return null;
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Extract title: prefer og:title, fallback to <title>
    let title = $('meta[property="og:title"]').attr("content") || "";
    if (!title) {
      title = $("title").text() || "";
    }
    title = title.trim();

    // Extract headings (h1, h2, h3)
    const headings: string[] = [];
    $("h1, h2, h3").each((_, el) => {
      const text = $(el).text().trim();
      if (text) {
        headings.push(text);
      }
    });

    // Remove unwanted elements before extracting text
    $("script, style, nav, header, footer, iframe, noscript, .header, .footer, .navigation, .sidebar").remove();

    // Extract main text
    const text = $("body").text().replace(/\s+/g, " ").trim();

    // Extract code blocks from <pre> elements
    const codeBlocks: string[] = [];
    $("pre").each((_, el) => {
      const code = $(el).text().trim();
      if (code) {
        codeBlocks.push(code);
      }
    });

    return {
      id: hashString(url),
      url,
      title,
      headings,
      text,
      codeBlocks,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    logDebug(`Error fetching ${url}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Extract links from HTML content that should be crawled
 */
function extractLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const links: Set<string> = new Set();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    try {
      // Resolve relative URLs
      const absoluteUrl = new URL(href, baseUrl).href;
      const normalized = normalizeUrl(absoluteUrl);

      if (isAllowedUrl(normalized)) {
        links.add(normalized);
      }
    } catch {
      // Invalid URL, skip
    }
  });

  return Array.from(links);
}

/**
 * Main crawler function - crawls documentation recursively
 */
async function crawlDocumentation(
  startUrl: string,
  maxPages: number,
  delayMs: number
): Promise<{ pages: IndexedPage[]; visited: number; failures: number }> {
  const visited = new Set<string>();
  const queue: string[] = [normalizeUrl(startUrl)];
  const pages: IndexedPage[] = [];
  let failures = 0;

  logDebug(`Starting crawl from ${startUrl}`);
  logDebug(`Max pages: ${maxPages}, Delay: ${delayMs}ms`);

  while (queue.length > 0 && pages.length < maxPages) {
    const url = queue.shift()!;
    const normalized = normalizeUrl(url);

    if (visited.has(normalized)) {
      continue;
    }

    visited.add(normalized);

    // Verify URL is still allowed (double-check)
    if (!isAllowedUrl(normalized)) {
      continue;
    }

    logDebug(`Crawling (${pages.length + 1}/${maxPages}): ${normalized}`);

    try {
      const response = await fetch(normalized, {
        headers: {
          "User-Agent": "DevExpress-MCP-Crawler/1.0 (Documentation Indexer)",
          "Accept": "text/html,application/xhtml+xml",
        },
      });

      if (!response.ok) {
        logDebug(`HTTP ${response.status} for ${normalized}`);
        failures++;
        continue;
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      // Extract title
      let title = $('meta[property="og:title"]').attr("content") || "";
      if (!title) {
        title = $("title").text() || "";
      }
      title = title.trim();

      // Extract headings
      const headings: string[] = [];
      $("h1, h2, h3").each((_, el) => {
        const text = $(el).text().trim();
        if (text) {
          headings.push(text);
        }
      });

      // Extract code blocks BEFORE removing elements
      const codeBlocks: string[] = [];
      $("pre").each((_, el) => {
        const code = $(el).text().trim();
        if (code) {
          codeBlocks.push(code);
        }
      });

      // Extract links BEFORE removing navigation
      const newLinks = extractLinks(html, normalized);
      for (const link of newLinks) {
        if (!visited.has(link)) {
          queue.push(link);
        }
      }

      // Remove unwanted elements for text extraction
      $("script, style, nav, header, footer, iframe, noscript").remove();
      $(".header, .footer, .navigation, .sidebar, .dx-header, .dx-footer").remove();

      // Extract main text
      const text = $("body").text().replace(/\s+/g, " ").trim();

      const page: IndexedPage = {
        id: hashString(normalized),
        url: normalized,
        title,
        headings,
        text,
        codeBlocks,
        fetchedAt: new Date().toISOString(),
      };

      pages.push(page);

    } catch (error) {
      logDebug(`Error: ${error instanceof Error ? error.message : String(error)}`);
      failures++;
    }

    // Rate limiting
    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }

  logDebug(`Crawl complete. Pages: ${pages.length}, Visited: ${visited.size}, Failures: ${failures}`);

  return { pages, visited: visited.size, failures };
}

// =============================================================================
// INDEX MANAGEMENT
// =============================================================================

/**
 * Build or rebuild the MiniSearch index from pages
 */
function buildSearchIndex(pages: IndexedPage[]): MiniSearch<IndexedPage> {
  const index = new MiniSearch<IndexedPage>({
    fields: ["title", "headings", "text", "codeBlocks"],
    storeFields: ["url", "title", "fetchedAt"],
    searchOptions: {
      boost: { title: 3, headings: 2 },
      fuzzy: 0.2,
      prefix: true,
    },
    // Custom extractor for array fields
    extractField: (document, fieldName) => {
      const value = document[fieldName as keyof IndexedPage];
      if (Array.isArray(value)) {
        return value.join(" ");
      }
      return value as string;
    },
  });

  index.addAll(pages);
  logDebug(`Search index built with ${pages.length} documents`);

  return index;
}

/**
 * Save pages and metadata to disk
 */
function saveIndex(pages: IndexedPage[], meta: IndexMeta): void {
  ensureDataDir();

  fs.writeFileSync(PAGES_FILE, JSON.stringify(pages, null, 2), "utf-8");
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2), "utf-8");

  logDebug(`Saved ${pages.length} pages to ${PAGES_FILE}`);
}

/**
 * Load pages and metadata from disk
 */
function loadIndex(): { pages: IndexedPage[]; meta: IndexMeta | null } {
  let pages: IndexedPage[] = [];
  let meta: IndexMeta | null = null;

  if (fs.existsSync(PAGES_FILE)) {
    try {
      const data = fs.readFileSync(PAGES_FILE, "utf-8");
      pages = JSON.parse(data) as IndexedPage[];
      logDebug(`Loaded ${pages.length} pages from disk`);
    } catch (error) {
      logDebug(`Error loading pages: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (fs.existsSync(META_FILE)) {
    try {
      const data = fs.readFileSync(META_FILE, "utf-8");
      meta = JSON.parse(data) as IndexMeta;
      logDebug(`Loaded metadata from disk`);
    } catch (error) {
      logDebug(`Error loading metadata: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { pages, meta };
}

/**
 * Initialize the search index on startup
 */
function initializeIndex(): void {
  const { pages, meta } = loadIndex();
  indexedPages = pages;
  indexMeta = meta;

  if (pages.length > 0) {
    searchIndex = buildSearchIndex(pages);
  } else {
    searchIndex = null;
  }
}

// =============================================================================
// MCP TOOL IMPLEMENTATIONS
// =============================================================================

/**
 * Tool: devexpress_bootstrap_status
 * Returns current index status
 */
function handleStatus(): string {
  if (!indexMeta) {
    return JSON.stringify({
      status: "no_index",
      message: "No index found. Run devexpress_bootstrap_refresh_index to create one.",
      dataDir: DATA_DIR,
      indexedCount: 0,
    }, null, 2);
  }

  return JSON.stringify({
    status: "ok",
    indexedCount: indexMeta.indexedCount,
    visitedCount: indexMeta.visitedCount,
    failureCount: indexMeta.failureCount,
    lastRefresh: indexMeta.lastRefresh,
    startUrl: indexMeta.startUrl,
    maxPages: indexMeta.maxPages,
    delayMs: indexMeta.delayMs,
    dataDir: DATA_DIR,
  }, null, 2);
}

/**
 * Tool: devexpress_bootstrap_refresh_index
 * Crawls documentation and rebuilds the index
 */
async function handleRefreshIndex(
  startUrl: string = DEFAULT_START_URL,
  maxPages: number = DEFAULT_MAX_PAGES,
  delayMs: number = DEFAULT_DELAY_MS
): Promise<string> {
  // Validate start URL
  if (!isAllowedUrl(startUrl)) {
    return JSON.stringify({
      status: "error",
      message: `Start URL must be on ${ALLOWED_HOST} and start with ${ALLOWED_PATH_PREFIX}`,
    }, null, 2);
  }

  try {
    const startTime = Date.now();
    const { pages, visited, failures } = await crawlDocumentation(startUrl, maxPages, delayMs);

    // Save to disk
    const meta: IndexMeta = {
      startUrl,
      maxPages,
      delayMs,
      indexedCount: pages.length,
      visitedCount: visited,
      failureCount: failures,
      lastRefresh: new Date().toISOString(),
      allowedHost: ALLOWED_HOST,
      allowedPathPrefix: ALLOWED_PATH_PREFIX,
    };

    saveIndex(pages, meta);

    // Update in-memory state
    indexedPages = pages;
    indexMeta = meta;
    searchIndex = buildSearchIndex(pages);

    const duration = Math.round((Date.now() - startTime) / 1000);

    return JSON.stringify({
      status: "success",
      message: `Successfully crawled and indexed ${pages.length} pages in ${duration} seconds.`,
      indexedCount: pages.length,
      visitedCount: visited,
      failureCount: failures,
      lastRefresh: meta.lastRefresh,
      dataDir: DATA_DIR,
    }, null, 2);
  } catch (error) {
    return JSON.stringify({
      status: "error",
      message: `Crawl failed: ${error instanceof Error ? error.message : String(error)}`,
    }, null, 2);
  }
}

/**
 * Tool: devexpress_bootstrap_open_top_result
 * Searches the index and returns the best matching page
 */
function handleOpenTopResult(
  query: string,
  includeCode: boolean = true,
  maxChars: number = 15000
): string {
  // Check if index exists
  if (!searchIndex || indexedPages.length === 0) {
    return JSON.stringify({
      status: "no_index",
      message: "No index available. Please run devexpress_bootstrap_refresh_index first.",
    }, null, 2);
  }

  // Perform search
  const results = searchIndex.search(query) as SearchResult[];

  if (results.length === 0) {
    return JSON.stringify({
      status: "no_results",
      message: `No results found for query: "${query}"`,
      query,
    }, null, 2);
  }

  // Get top result
  const topResult = results[0];
  const topPage = indexedPages.find(p => p.id === topResult.id);

  if (!topPage) {
    return JSON.stringify({
      status: "error",
      message: "Internal error: could not find page data for top result",
    }, null, 2);
  }

  // Security check: verify page is from allowed source
  if (!isAllowedUrl(topPage.url)) {
    return JSON.stringify({
      status: "error",
      message: "Security error: result URL is not from allowed domain",
    }, null, 2);
  }

  // Build top 3 list (titles and URLs)
  const top3 = results.slice(0, 3).map(r => {
    const page = indexedPages.find(p => p.id === r.id);
    return {
      title: page?.title || "Unknown",
      url: page?.url || "",
      score: r.score,
    };
  });

  // Truncate text to maxChars
  let text = topPage.text;
  if (text.length > maxChars) {
    text = text.slice(0, maxChars) + "\n\n[... truncated at " + maxChars + " characters ...]";
  }

  // Build response
  const response: Record<string, unknown> = {
    status: "success",
    query,
    title: topPage.title,
    url: topPage.url,
    fetchedAt: topPage.fetchedAt,
    headings: topPage.headings.slice(0, 10), // Limit headings
    text,
    top3Results: top3,
  };

  // Include code blocks if requested
  if (includeCode && topPage.codeBlocks.length > 0) {
    response.codeBlocks = topPage.codeBlocks.slice(0, 5); // Up to 5 code blocks
  }

  return JSON.stringify(response, null, 2);
}

// =============================================================================
// MCP SERVER SETUP
// =============================================================================

/** Tool definitions for MCP */
const TOOLS: Tool[] = [
  {
    name: "devexpress_bootstrap_status",
    description: "Returns the current status of the DevExpress ASP.NET Bootstrap documentation index. Shows indexed page count, last refresh time, failure counts, and data directory path.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "devexpress_bootstrap_refresh_index",
    description: "Crawls the DevExpress ASP.NET Bootstrap documentation and rebuilds the local search index. This may take several minutes depending on the maxPages setting.",
    inputSchema: {
      type: "object",
      properties: {
        startUrl: {
          type: "string",
          description: "The starting URL for crawling. Must be under docs.devexpress.com/AspNetBootstrap/",
          default: DEFAULT_START_URL,
        },
        maxPages: {
          type: "number",
          description: "Maximum number of pages to index",
          default: DEFAULT_MAX_PAGES,
        },
        delayMs: {
          type: "number",
          description: "Delay between requests in milliseconds (for rate limiting)",
          default: DEFAULT_DELAY_MS,
        },
      },
      required: [],
    },
  },
  {
    name: "devexpress_bootstrap_open_top_result",
    description: "Searches the indexed DevExpress ASP.NET Bootstrap documentation and returns the best matching page. Uses the local index (no live web requests). Run refresh_index first if no index exists.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query (e.g., 'BootstrapGridView column editing' or 'TreeView node selection')",
        },
        includeCode: {
          type: "boolean",
          description: "Whether to include code examples from the page",
          default: true,
        },
        maxChars: {
          type: "number",
          description: "Maximum characters of text content to return",
          default: 15000,
        },
      },
      required: ["query"],
    },
  },
];

/**
 * Create and configure the MCP server
 */
function createServer(): Server {
  const server = new Server(
    {
      name: "devexpress-bootstrap-docs",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Handle tool listing
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case "devexpress_bootstrap_status": {
          const result = handleStatus();
          return {
            content: [{ type: "text", text: result }],
          };
        }

        case "devexpress_bootstrap_refresh_index": {
          const startUrl = (args?.startUrl as string) || DEFAULT_START_URL;
          const maxPages = (args?.maxPages as number) || DEFAULT_MAX_PAGES;
          const delayMs = (args?.delayMs as number) || DEFAULT_DELAY_MS;
          const result = await handleRefreshIndex(startUrl, maxPages, delayMs);
          return {
            content: [{ type: "text", text: result }],
          };
        }

        case "devexpress_bootstrap_open_top_result": {
          const query = args?.query as string;
          if (!query) {
            return {
              content: [{ type: "text", text: JSON.stringify({ status: "error", message: "Query parameter is required" }) }],
              isError: true,
            };
          }
          const includeCode = args?.includeCode !== false;
          const maxChars = (args?.maxChars as number) || 15000;
          const result = handleOpenTopResult(query, includeCode, maxChars);
          return {
            content: [{ type: "text", text: result }],
          };
        }

        default:
          return {
            content: [{ type: "text", text: JSON.stringify({ status: "error", message: `Unknown tool: ${name}` }) }],
            isError: true,
          };
      }
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "error",
              message: error instanceof Error ? error.message : String(error),
            }),
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

// =============================================================================
// MAIN ENTRY POINT
// =============================================================================

async function main(): Promise<void> {
  logDebug("DevExpress ASP.NET Bootstrap MCP Server starting...");
  logDebug(`Data directory: ${DATA_DIR}`);

  // Initialize index from disk (if exists)
  initializeIndex();

  // Create and start server
  const server = createServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);
  logDebug("MCP Server connected and ready");
}

// Run the server
main().catch((error) => {
  logDebug(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
