#!/usr/bin/env node

/**
 * Standalone Crawler Script
 *
 * Run this directly with: npm run crawl
 * This bypasses the 60-second MCP tool timeout by running as a standalone Node.js process.
 *
 * Usage:
 *   npm run crawl                        # crawl with default settings (800 pages, 200ms)
 *   npm run crawl -- --max 500           # crawl 500 pages
 *   npm run crawl -- --max 1000 --delay 300   # 1000 pages, 300ms delay
 *   npm run crawl -- --continue          # CONTINUE from where last crawl stopped
 *   npm run crawl -- --continue --max 2000   # Continue and increase limit
 */

import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(PROJECT_ROOT, "data");
const PAGES_FILE = path.join(DATA_DIR, "pages.json");
const META_FILE = path.join(DATA_DIR, "meta.json");
const QUEUE_FILE = path.join(DATA_DIR, "crawl_queue.json"); // For resume support

const DEFAULT_START_URL = "https://docs.devexpress.com/AspNetBootstrap/117864/aspnet-bootstrap-controls";
const DEFAULT_MAX_PAGES = 800;
const DEFAULT_DELAY_MS = 200;
const ALLOWED_HOST = "docs.devexpress.com";
const ALLOWED_PATH_PREFIX = "/AspNetBootstrap/";

interface IndexedPage {
  id: string;
  url: string;
  title: string;
  headings: string[];
  text: string;
  codeBlocks: string[];
  fetchedAt: string;
}

interface IndexMeta {
  startUrl: string;
  maxPages: number;
  delayMs: number;
  indexedCount: number;
  visitedCount: number;
  failureCount: number;
  lastRefresh: string;
  allowedHost: string;
  allowedPathPrefix: string;
}

// CLI arguments
const args = process.argv.slice(2);
const getMax = () => {
  const idx = args.indexOf("--max");
  return idx >= 0 && args[idx + 1] ? parseInt(args[idx + 1]) : DEFAULT_MAX_PAGES;
};
const getDelay = () => {
  const idx = args.indexOf("--delay");
  return idx >= 0 && args[idx + 1] ? parseInt(args[idx + 1]) : DEFAULT_DELAY_MS;
};
const getStartUrl = () => {
  const idx = args.indexOf("--url");
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : DEFAULT_START_URL;
};

function log(message: string): void {
  const timestamp = new Date().toISOString().split("T")[1].slice(0, 8);
  console.log(`[${timestamp}] ${message}`);
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function normalizeUrl(urlString: string): string {
  try {
    const url = new URL(urlString);
    url.hash = "";
    url.search = "";
    let normalized = url.href;
    if (normalized.endsWith("/") && url.pathname !== "/") {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  } catch {
    return urlString;
  }
}

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

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function extractLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const links: Set<string> = new Set();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    try {
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

async function crawlDocumentation(
  startUrl: string,
  maxPages: number,
  delayMs: number
): Promise<{ pages: IndexedPage[]; visited: number; failures: number }> {
  const visited = new Set<string>();
  const queue: string[] = [normalizeUrl(startUrl)];
  const pages: IndexedPage[] = [];
  let failures = 0;

  log(`🚀 Starting crawl from ${startUrl}`);
  log(`📊 Max pages: ${maxPages}, Delay: ${delayMs}ms`);
  log(`⏱️  Estimated time: ~${Math.ceil(maxPages * delayMs / 60000)} minutes\n`);

  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 10;

  while (queue.length > 0 && pages.length < maxPages) {
    const url = queue.shift()!;
    const normalized = normalizeUrl(url);

    if (visited.has(normalized)) {
      continue;
    }

    visited.add(normalized);

    if (!isAllowedUrl(normalized)) {
      continue;
    }

    const progress = Math.round((pages.length / maxPages) * 100);
    log(`[${progress}%] Crawling (${pages.length + 1}/${maxPages}): ${normalized.substring(0, 80)}...`);

    try {
      const response = await fetch(normalized, {
        headers: {
          "User-Agent": "DevExpress-MCP-Crawler/1.0 (Documentation Indexer)",
          "Accept": "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(30000), // 30 second timeout per request
      });

      if (!response.ok) {
        log(`⚠️  HTTP ${response.status} for ${normalized}`);
        failures++;
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          log(`❌ Too many consecutive failures (${consecutiveFailures}). Stopping crawl.`);
          break;
        }
        continue;
      }

      consecutiveFailures = 0; // Reset on success
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

      // Save progress every 50 pages
      if (pages.length % 50 === 0) {
        saveProgress(pages, { indexedCount: pages.length, visitedCount: visited.size, failureCount: failures });
        log(`💾 Progress saved (${pages.length} pages)`);
      }

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log(`❌ Error: ${msg}`);
      failures++;
      consecutiveFailures++;
      
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        log(`❌ Too many consecutive failures (${consecutiveFailures}). Stopping crawl.`);
        break;
      }
    }

    // Rate limiting
    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }

  log(`\n✅ Crawl complete!`);
  log(`📊 Pages indexed: ${pages.length}`);
  log(`🌐 URLs visited: ${visited.size}`);
  log(`❌ Failures: ${failures}`);

  return { pages, visited: visited.size, failures };
}

function saveProgress(pages: IndexedPage[], partialMeta: Partial<IndexMeta>): void {
  ensureDataDir();
  fs.writeFileSync(PAGES_FILE, JSON.stringify(pages, null, 2), "utf-8");
  
  const meta: IndexMeta = {
    startUrl: getStartUrl(),
    maxPages: getMax(),
    delayMs: getDelay(),
    indexedCount: partialMeta.indexedCount || pages.length,
    visitedCount: partialMeta.visitedCount || pages.length,
    failureCount: partialMeta.failureCount || 0,
    lastRefresh: new Date().toISOString(),
    allowedHost: ALLOWED_HOST,
    allowedPathPrefix: ALLOWED_PATH_PREFIX,
  };
  
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2), "utf-8");
}

async function main(): Promise<void> {
  let maxPages = getMax();
  const delayMs = getDelay();
  let startUrl = getStartUrl();
  const shouldContinue = args.includes("--continue");

  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║   DevExpress ASP.NET Bootstrap Documentation Crawler    ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  // Load existing progress if continuing
  let existingPages: IndexedPage[] = [];
  if (shouldContinue && fs.existsSync(PAGES_FILE)) {
    try {
      const data = fs.readFileSync(PAGES_FILE, "utf-8");
      existingPages = JSON.parse(data) as IndexedPage[];
      log(`📂 Found existing index with ${existingPages.length} pages`);
      log(`🔄 CONTINUING from previous crawl...`);
      
      // If no max pages specified in args, increase default
      if (args.indexOf("--max") === -1) {
        maxPages = Math.max(DEFAULT_MAX_PAGES * 2, existingPages.length + 500);
        log(`📊 Automatically increased maxPages to ${maxPages}`);
      }
    } catch (error) {
      log(`⚠️  Could not load existing pages, starting fresh`);
      existingPages = [];
    }
  } else if (shouldContinue && !fs.existsSync(PAGES_FILE)) {
    log(`⚠️  No existing index found. Starting fresh crawl.`);
  }

  const startTime = Date.now();

  const { pages, visited, failures } = await crawlDocumentation(startUrl, maxPages, delayMs);

  // Merge with existing pages if continuing
  let finalPages = pages;
  if (shouldContinue && existingPages.length > 0) {
    // Create a set of existing URLs to avoid duplicates
    const existingUrls = new Set(existingPages.map(p => p.url));
    const newPages = pages.filter(p => !existingUrls.has(p.url));
    finalPages = [...existingPages, ...newPages];
    log(`✅ Merged ${newPages.length} new pages with ${existingPages.length} existing pages`);
    log(`📊 Total unique pages: ${finalPages.length}`);
  }

  // Final save
  saveProgress(finalPages, { indexedCount: finalPages.length, visitedCount: visited, failureCount: failures });

  const duration = Math.round((Date.now() - startTime) / 1000);
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;

  console.log(`\n⏱️  Total time: ${minutes}m ${seconds}s`);
  console.log(`📁 Data saved to: ${DATA_DIR}`);
  console.log(`\n✨ You can now search the docs using the MCP server!\n`);
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});
