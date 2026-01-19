#!/usr/bin/env node

/**
 * Standalone Crawler Script
 *
 * Run this directly with: npm run crawl
 * This bypasses the 60-second MCP tool timeout by running as a standalone Node.js process.
 *
 * Usage:
 *   npm run crawl                                    # crawl docs with default settings
 *   npm run crawl:docs                               # crawl docs with default settings
 *   npm run crawl:github                             # crawl GitHub code examples
 *   npm run crawl:all                                # crawl both docs and GitHub examples
 *   npm run crawl -- --type docs --max 500           # crawl 500 docs pages
 *   npm run crawl -- --type github --max 200         # crawl 200 GitHub files
 *   npm run crawl -- --type docs --continue          # continue from previous docs crawl
 */

import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  crawlGitHubExamples,
  saveGitHubExamples,
  type GitHubExample,
} from "./github-crawler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(PROJECT_ROOT, "data");
const PAGES_FILE = path.join(DATA_DIR, "pages.json");
const META_FILE = path.join(DATA_DIR, "meta.json");
const GITHUB_EXAMPLES_FILE = path.join(DATA_DIR, "github-examples.json");
const GITHUB_META_FILE = path.join(DATA_DIR, "github-meta.json");

const DEFAULT_START_URL = "https://docs.devexpress.com/AspNetBootstrap/117864/aspnet-bootstrap-controls";
const DEFAULT_MAX_PAGES = 800;
const DEFAULT_MAX_FILES = 100;
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
const getType = () => {
  const idx = args.indexOf("--type");
  if (idx >= 0 && args[idx + 1]) {
    const type = args[idx + 1];
    if (["docs", "github", "all"].includes(type)) return type;
  }
  return "docs"; // default
};
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
const getGithubToken = () => {
  const idx = args.indexOf("--github-token");
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : undefined;
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

  log(`🚀 Starting documentation crawl from ${startUrl}`);
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
        signal: AbortSignal.timeout(30000),
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

      consecutiveFailures = 0;
      const html = await response.text();
      const $ = cheerio.load(html);

      let title = $('meta[property="og:title"]').attr("content") || "";
      if (!title) {
        title = $("title").text() || "";
      }
      title = title.trim();

      const headings: string[] = [];
      $("h1, h2, h3").each((_, el) => {
        const text = $(el).text().trim();
        if (text) {
          headings.push(text);
        }
      });

      const codeBlocks: string[] = [];
      $("pre").each((_, el) => {
        const code = $(el).text().trim();
        if (code) {
          codeBlocks.push(code);
        }
      });

      const newLinks = extractLinks(html, normalized);
      for (const link of newLinks) {
        if (!visited.has(link)) {
          queue.push(link);
        }
      }

      $("script, style, nav, header, footer, iframe, noscript").remove();
      $(".header, .footer, .navigation, .sidebar, .dx-header, .dx-footer").remove();

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

      if (pages.length % 50 === 0) {
        saveDocs(pages, { indexedCount: pages.length, visitedCount: visited.size, failureCount: failures });
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

    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }

  log(`\n✅ Documentation crawl complete!`);
  log(`📊 Pages indexed: ${pages.length}`);
  log(`🌐 URLs visited: ${visited.size}`);
  log(`❌ Failures: ${failures}`);

  return { pages, visited: visited.size, failures };
}

function saveDocs(pages: IndexedPage[], partialMeta: Partial<IndexMeta>): void {
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

async function crawlGitHub(): Promise<void> {
  const maxFiles = getMax();
  const delayMs = getDelay();
  const githubToken = getGithubToken();

  log(`🚀 Starting GitHub code examples crawl`);
  log(`📊 Max files: ${maxFiles}, Delay: ${delayMs}ms`);

  const startTime = Date.now();
  const { examples, meta } = await crawlGitHubExamples({
    maxFiles,
    githubToken,
    delayMs,
  });

  saveGitHubExamples(examples, meta);

  const duration = Math.round((Date.now() - startTime) / 1000);
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;

  log(`\n✅ GitHub crawl complete!`);
  log(`📊 Examples indexed: ${examples.length}`);
  log(`📦 Repositories: ${meta.repos.length}`);
  meta.repos.forEach(repo => {
    log(`   - ${repo.name}: ${repo.filesIndexed} files`);
  });
  log(`⏱️  Total time: ${minutes}m ${seconds}s`);
}

async function main(): Promise<void> {
  const crawlType = getType();

  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║     DevExpress Bootstrap MCP - Crawler Tool              ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  log(`🎯 Crawl type: ${crawlType}`);

  const startTime = Date.now();

  try {
    if (crawlType === "docs" || crawlType === "all") {
      log(`\n📚 === Crawling Documentation ===${crawlType === "all" ? " (1/2)" : ""}`);
      const maxPages = getMax();
      const delayMs = getDelay();
      const startUrl = getStartUrl();

      let existingPages: IndexedPage[] = [];
      if (args.includes("--continue") && fs.existsSync(PAGES_FILE)) {
        try {
          const data = fs.readFileSync(PAGES_FILE, "utf-8");
          existingPages = JSON.parse(data) as IndexedPage[];
          log(`📂 Found existing index with ${existingPages.length} pages`);
          log(`🔄 CONTINUING from previous crawl...`);
        } catch (error) {
          log(`⚠️  Could not load existing pages, starting fresh`);
        }
      }

      const { pages, visited, failures } = await crawlDocumentation(startUrl, maxPages, delayMs);

      let finalPages = pages;
      if (args.includes("--continue") && existingPages.length > 0) {
        const existingUrls = new Set(existingPages.map(p => p.url));
        const newPages = pages.filter(p => !existingUrls.has(p.url));
        finalPages = [...existingPages, ...newPages];
        log(`✅ Merged ${newPages.length} new pages with ${existingPages.length} existing pages`);
        log(`📊 Total unique pages: ${finalPages.length}`);
      }

      saveDocs(finalPages, { indexedCount: finalPages.length, visitedCount: visited, failureCount: failures });
    }

    if (crawlType === "github" || crawlType === "all") {
      log(`\n💻 === Crawling GitHub Examples ===${crawlType === "all" ? " (2/2)" : ""}`);
      await crawlGitHub();
    }

    const duration = Math.round((Date.now() - startTime) / 1000);
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;

    console.log(`\n⏱️  Total time: ${minutes}m ${seconds}s`);
    console.log(`📁 Data saved to: ${DATA_DIR}`);
    console.log(`\n✨ Ready to search! Start the MCP server with: npm run start\n`);
  } catch (error) {
    log(`❌ Fatal error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});
