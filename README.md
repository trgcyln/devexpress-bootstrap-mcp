# DevExpress ASP.NET Bootstrap Documentation MCP Server

<p align="center">
  <img src="https://img.shields.io/badge/MCP-Model%20Context%20Protocol-blue?style=for-the-badge" alt="MCP">
  <img src="https://img.shields.io/badge/Node.js-18%2B-green?style=for-the-badge" alt="Node.js">
  <img src="https://img.shields.io/badge/TypeScript-ESM-blue?style=for-the-badge" alt="TypeScript">
  <img src="https://img.shields.io/badge/Platform-Windows-lightgrey?style=for-the-badge" alt="Windows">
</p>

A **Model Context Protocol (MCP) server** that crawls and indexes the complete [DevExpress ASP.NET Bootstrap documentation](https://docs.devexpress.com/AspNetBootstrap/) **AND GitHub code examples**, providing **instant local search** for AI-assisted code generation.

## ✨ Features

- 📦 **Starter Index Included** - 500 essential pages pre-indexed (~1.67 MB) - works out of the box!
- 🕷️ **Complete Documentation Crawler** - Can index 8,000+ pages from DevExpress Bootstrap docs
- 💻 **GitHub Code Examples** - Index real C#, ASPX, ASCX code from DevExpress-Examples
- 🔍 **Instant Search** - Full-text search with fuzzy matching and code snippets
- 💾 **Offline Access** - Once indexed, works without internet
- 🤖 **AI Integration** - Works with Roo Code, Claude, and any MCP-compatible AI
- ⚡ **Fast** - In-memory search index, queries take ~50ms
- 🔄 **Resume Support** - Crawler can continue from where it stopped

## 📋 Table of Contents

- [Prerequisites](#-prerequisites)
- [Installation](#-installation)
- [Roo Code Setup](#-roo-code-setup)
- [Usage](#-usage)
- [Commands](#-commands)
- [Updating the Index](#-updating-the-index)
- [MCP Tools Reference](#-mcp-tools-reference)
- [Troubleshooting](#-troubleshooting)
- [Project Structure](#-project-structure)
- [Contributing](#-contributing)
- [License](#-license)

---

## 📦 Prerequisites

Before you begin, ensure you have:

### 1. Node.js (v18 or higher)

**Check if installed:**
```bash
node --version
```

**Install Node.js:**
- Download from [nodejs.org](https://nodejs.org/)
- Or use [nvm-windows](https://github.com/coreybutler/nvm-windows) for version management

### 2. Git (for cloning)

```bash
git --version
```

If not installed, download from [git-scm.com](https://git-scm.com/)

### 3. VS Code with Roo Code Extension

1. Install [Visual Studio Code](https://code.visualstudio.com/)
2. Install the **Roo Code** extension:
   - Open VS Code
   - Press `Ctrl+Shift+X` to open Extensions
   - Search for "Roo Code"
   - Click **Install**

---

## 🚀 Installation

### Step 1: Clone the Repository

```bash
# Clone to your preferred location
git clone https://github.com/trgcyln/devexpress-bootstrap-mcp.git

# Or download and extract the ZIP from GitHub
```

### Step 2: Navigate to Project Directory

```bash
cd devexpress-bootstrap-mcp
```

### Step 3: Install Dependencies

```bash
npm install
```

### Step 4: Build the Project

```bash
npm run build
```

### Step 5: Ready to Use!

✨ **This repository includes a starter index** with 500 essential DevExpress Bootstrap pages (~1.67 MB).

You can immediately start using the MCP without any additional crawling!

---

## ⚡ For Full Performance (Recommended)

The starter index covers the most common documentation pages, but **for best results, re-index the full documentation**:

```bash
npm run crawl -- --max 10000 --delay 300
```

| Index Type | Pages | Size | Coverage | Search Quality |
|------------|-------|------|----------|----------------|
| **Starter** (included) | 500 | ~1.67 MB | Core docs | Good ✅ |
| **Full** (recommended) | 8,000+ | ~200 MB | Complete | Excellent ⭐⭐⭐ |

**Why re-index?**
- 🔍 Access to **ALL** DevExpress Bootstrap documentation
- 📚 Complete API reference
- 💡 More code examples
- 🎯 Better search relevance

**Full crawl takes ~30-60 minutes** (one-time only). Progress is saved every 50 pages, so you can interrupt and resume anytime with `--continue`.

---

## 🔧 Roo Code Setup

### Step 1: Open MCP Settings

In VS Code with Roo Code installed:

1. Press `Ctrl+Shift+P` to open Command Palette
2. Type **"MCP: Edit Global Config"** and press Enter
3. This opens `mcp_settings.json`

### Step 2: Add the MCP Server Configuration

Add the following to your `mcp_settings.json`:

```json
{
  "mcpServers": {
    "devexpress-bootstrap-docs": {
      "command": "npm",
      "args": ["run", "start"],
      "cwd": "C:\\path\\to\\devexpress-bootstrap-mcp",
      "alwaysAllow": [
        "devexpress_bootstrap_status",
        "devexpress_bootstrap_refresh_index",
        "devexpress_bootstrap_open_top_result",
        "devexpress_bootstrap_refresh_github",
        "devexpress_bootstrap_search_examples"
      ]
    }
  }
}
```

> ⚠️ **Important:** Replace `C:\\path\\to\\devexpress-bootstrap-mcp` with your actual project path. Use double backslashes `\\` on Windows!

**Example paths:**
- `"C:\\MCP\\DevExpress"`
- `"C:\\Users\\YourName\\Projects\\devexpress-bootstrap-mcp"`

### Step 3: Restart VS Code

Close and reopen VS Code completely for changes to take effect.

### Step 4: Verify Connection

In the Roo Code chat, type:

```
Check devexpress_bootstrap_status
```

You should see a response like:
```json
{
  "status": "ok",
  "indexedCount": 500,
  "visitedCount": 500,
  "failureCount": 0
}
```

> 💡 **Tip:** Run `npm run crawl -- --max 10000` to expand from 500 to 8,000+ pages for full coverage.

---

## 💬 Usage

Once configured, you can ask Claude/Roo Code about DevExpress Bootstrap controls naturally:

### Example Queries

```
Show me BootstrapButton click event example, use devexpress mcp
```

```
How do I use BootstrapGridView column editing, use devexpress mcp
```

```
Search devexpress docs for DateEdit date range picker
```

```
BootstrapTreeView node selection example, use devexpress mcp
```

### Tips for Best Results

| Do ✅ | Don't ❌ |
|------|---------|
| "BootstrapButton click example, use devexpress mcp" | "Show me a button" (too generic) |
| "DevExpress GridView filtering" | "Grid filter" (ambiguous) |
| "ASP.NET Bootstrap DateEdit" | "date picker" (could be any library) |

---

## 📜 Commands

| Command | Description |
|---------|-------------|
| `npm install` | Install dependencies |
| `npm run build` | Compile TypeScript |
| `npm run start` | Start MCP server (used by Roo Code) |
| `npm run crawl:docs` | Crawl only documentation (default: 800 pages) |
| `npm run crawl:github` | Crawl only GitHub code examples |
| `npm run crawl:all` | Crawl both docs and GitHub examples |
| `npm run crawl -- --max 5000` | ⚠️ **Note the double dash `--`** |
| `npm run crawl -- --type github --max 200` | Crawl GitHub with options |

### ⚠️ Important: Double Dash for Arguments

When passing options to npm scripts, **always use `--`** before your arguments:

```bash
# ✅ Correct (with double dash)
npm run crawl -- --type docs --max 500

# ❌ Wrong (missing double dash)
npm run crawl --type docs --max 500
```

### Crawler Options

| Option | Default | Description |
|--------|---------|-------------|
| `--type {docs,github,all}` | docs | What to crawl: docs, GitHub examples, or both |
| `--max N` | 800/100 | Maximum pages (docs) or files (GitHub) to index |
| `--delay N` | 200 | Milliseconds between requests |
| `--continue` | false | Resume from previous crawl (docs only) |
| `--github-token TOKEN` | - | GitHub personal access token (for higher rate limits) |

---

## 🔄 Updating the Index

### When to Update

- After a new DevExpress version release
- If you notice missing documentation
- Periodically (e.g., monthly) to catch updates

### How to Update

**Option 1: Full Re-crawl (Recommended)**
```bash
npm run crawl -- --max 10000 --delay 300
```

**Option 2: Continue/Add New Pages**
```bash
npm run crawl -- --continue --max 10000
```

**Option 3: Via MCP Tool (Limited)**
```
Run devexpress_bootstrap_refresh_index with maxPages=100
```
> Note: The MCP tool has a 60-second timeout, limiting it to ~100 pages per call.

---

## 🛠️ MCP Tools Reference

### 1. `devexpress_bootstrap_status`

Check the current index status for both documentation and GitHub examples.

**Usage:**
```
Check devexpress_bootstrap_status
```

**Response:**
```json
{
  "status": "ok",
  "documentation": {
    "indexedCount": 500,
    "lastRefresh": "2026-01-19T13:00:00.000Z"
  },
  "githubExamples": {
    "totalExamples": 100,
    "lastRefresh": "2026-01-19T14:00:00.000Z"
  },
  "dataDir": "C:\\MCP\\DevExpress\\data"
}
```

---

### 2. `devexpress_bootstrap_refresh_index`

Crawl and update the documentation index.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `startUrl` | string | (DevExpress docs root) | Start URL |
| `maxPages` | number | 800 | Max pages to crawl |
| `delayMs` | number | 200 | Delay between requests |

**Usage:**
```
Run devexpress_bootstrap_refresh_index with maxPages=100
```

---

### 3. `devexpress_bootstrap_open_top_result`

Search the indexed documentation.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `query` | string | *required* | Search query |
| `includeCode` | boolean | true | Include code examples |
| `maxChars` | number | 15000 | Max text length |

**Usage:**
```
Search for "BootstrapGridView column editing" in DevExpress docs
```

**Response includes:**
- Page title and URL
- Headings
- Text content
- Code examples (up to 5)
- Top 3 related results

---

### 4. `devexpress_bootstrap_refresh_github`

Index code examples from DevExpress GitHub repositories.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `maxFiles` | number | 100 | Maximum code files to index |
| `githubToken` | string | - | GitHub personal access token (optional) |
| `delayMs` | number | 200 | Delay between API requests |

**Usage:**
```
Run devexpress_bootstrap_refresh_github with maxFiles=200
```

> 💡 **GitHub Token:** Without a token, GitHub API is limited to 60 requests/hour. With a token, you get 5,000 requests/hour.

---

### 5. `devexpress_bootstrap_search_examples`

Search indexed GitHub code examples for real-world implementations.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `query` | string | *required* | Search query (class name, method, etc.) |
| `language` | string | all | Filter: "csharp", "aspx", or "ascx" |
| `maxResults` | number | 5 | Maximum results to return |

**Usage:**
```
Search GitHub examples for "BootstrapGridView" in csharp
```

**Response includes:**
- File name and path
- Repository name
- Direct GitHub file URL
- Language (csharp/aspx/ascx)
- Code preview
- Related classes and methods

---

## ❓ Troubleshooting

### "No index available" Error

**Cause:** The documentation hasn't been indexed yet.

**Solution:** Run the crawler first:
```bash
npm run crawl -- --max 100
```

---

### MCP Server Not Appearing in Roo Code

**Check:**
1. Is the `cwd` path correct in `mcp_settings.json`?
2. Did you use double backslashes `\\` on Windows?
3. Did you restart VS Code completely?
4. Is the project built? (`npm run build`)

**Test manually:**
```bash
cd C:\path\to\devexpress-bootstrap-mcp
npm run start
```

---

### Crawl Timeouts or Failures

**Solution 1:** Increase delay between requests:
```bash
npm run crawl -- --delay 500
```

**Solution 2:** Reduce max pages per session:
```bash
npm run crawl -- --max 500
```

**Solution 3:** Use continue mode after interruption:
```bash
npm run crawl -- --continue
```

---

### Search Results Not Relevant

1. Check index status: `Check devexpress_bootstrap_status`
2. Use more specific queries
3. Include "DevExpress" or "Bootstrap" in your query
4. Refresh the index if it's outdated

---

## 📁 Project Structure

```
devexpress-bootstrap-mcp/
├── src/
│   ├── server.ts          # MCP server (5 tools: docs + GitHub)
│   ├── crawl.ts           # Standalone crawler (docs + GitHub)
│   └── github-crawler.ts  # GitHub API crawler module
├── data/                   # Included: Starter index (500 pages)
│   ├── pages.json         # Indexed docs (~1.67 MB starter, ~200 MB full)
│   ├── meta.json          # Docs crawl metadata
│   ├── github-examples.json # Indexed code examples (after GitHub crawl)
│   └── github-meta.json    # GitHub crawl metadata
├── dist/                   # Compiled JavaScript (created on build)
│   ├── server.js
│   ├── crawl.js
│   └── github-crawler.js
├── package.json           # Dependencies & scripts
├── tsconfig.json          # TypeScript configuration
├── .gitignore             # Git ignore rules
├── LICENSE                # MIT License
└── README.md              # This file
```

**Note:** The repository includes a starter index with 500 essential pages (~1.67 MB).
- Run `npm run crawl:docs` to expand to 8,000+ documentation pages
- Run `npm run crawl:github` to index 100+ code examples from GitHub
- Run `npm run crawl:all` to index both

---

## 🤝 Contributing

Contributions are welcome! Here's how:

1. **Fork** the repository
2. **Create** a feature branch: `git checkout -b feature/amazing-feature`
3. **Commit** changes: `git commit -m 'Add amazing feature'`
4. **Push** to branch: `git push origin feature/amazing-feature`
5. **Open** a Pull Request

### Ideas for Contributions

- Add support for other DevExpress documentation (WinForms, WPF, etc.)
- Improve search relevance
- Add caching layer for faster startup
- Support for macOS/Linux
- Docker deployment option

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- [DevExpress](https://www.devexpress.com/) for their excellent documentation
- [Model Context Protocol](https://modelcontextprotocol.io/) for the MCP SDK
- [MiniSearch](https://github.com/lucaong/minisearch) for the search engine
- [Cheerio](https://cheerio.js.org/) for HTML parsing

---

## 📞 Support

- **Issues:** [GitHub Issues](https://github.com/trgcyln/devexpress-bootstrap-mcp/issues)
- **Discussions:** [GitHub Discussions](https://github.com/trgcyln/devexpress-bootstrap-mcp/discussions)

---

<p align="center">
  Made with ❤️ for the DevExpress community
</p>
