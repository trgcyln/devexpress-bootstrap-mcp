import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');
const DATA_DIR = join(PROJECT_ROOT, 'data');
const GITHUB_EXAMPLES_FILE = join(DATA_DIR, 'github-examples.json');
const GITHUB_META_FILE = join(DATA_DIR, 'github-meta.json');

export interface GitHubExample {
  id: string;
  type: 'example' | 'code-file';
  title: string;
  filePath: string;
  repoName: string;
  repoUrl: string;
  fileUrl: string;
  language: string;
  content: string;
  contentPreview: string;
  relatedClasses: string[];
  relatedMethods: string[];
  description: string;
  fetchedAt: string;
}

interface GitHubMetadata {
  totalExamples: number;
  lastRefresh: string;
  lastError?: string;
  repos: Array<{
    name: string;
    url: string;
    filesIndexed: number;
  }>;
}

// DevExpress repositories with ASP.NET Bootstrap examples
const DEVEXPRESS_REPOS = [
  { owner: 'DevExpress', repo: 'DevExtreme.AspNet.Data', paths: ['net'] },
  { owner: 'DevExpress-Examples', repo: 'asp-net-web-forms-grid-view-batch-edit-mode', paths: [''] },
  { owner: 'DevExpress-Examples', repo: 'asp-net-web-forms-grid-layout', paths: [''] },
  { owner: 'DevExpress-Examples', repo: 'asp-net-bootstrap-controls-demos', paths: ['CS'] },
  { owner: 'DevExpress-Examples', repo: 'aspnet-bootstrap-controls-how-to-get-started', paths: [''] },
  { owner: 'DevExpress-Examples', repo: 'reporting-how-to-use-aspnet-webforms-bootstrap-web-report-viewer', paths: [''] },
];

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * List files in a GitHub directory using Contents API
 */
async function listRepoContents(
  owner: string,
  repo: string,
  path: string = '',
  token?: string
): Promise<Array<{ path: string; type: string; download_url: string | null }>> {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'DevExpress-MCP-Crawler/1.0',
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      const text = await response.text();
      console.error(`GitHub API error for ${owner}/${repo}/${path}: ${response.status} - ${text.substring(0, 100)}`);
      return [];
    }

    const data = await response.json();
    if (!Array.isArray(data)) {
      return [];
    }

    return data.map((item: any) => ({
      path: item.path,
      type: item.type,
      download_url: item.download_url,
    }));
  } catch (error) {
    console.error(`Error listing ${owner}/${repo}/${path}:`, error);
    return [];
  }
}

/**
 * Recursively find code files in a repository
 */
async function findCodeFiles(
  owner: string,
  repo: string,
  basePath: string,
  token?: string,
  maxDepth: number = 3,
  currentDepth: number = 0,
  maxFiles: number = 50
): Promise<Array<{ path: string; download_url: string }>> {
  if (currentDepth > maxDepth) return [];

  const contents = await listRepoContents(owner, repo, basePath, token);
  const files: Array<{ path: string; download_url: string }> = [];

  for (const item of contents) {
    if (files.length >= maxFiles) break;

    if (item.type === 'file') {
      const ext = item.path.toLowerCase();
      if (ext.endsWith('.cs') || ext.endsWith('.aspx') || ext.endsWith('.ascx') || ext.endsWith('.aspx.cs')) {
        if (item.download_url) {
          files.push({ path: item.path, download_url: item.download_url });
        }
      }
    } else if (item.type === 'dir' && currentDepth < maxDepth) {
      // Skip common non-code directories
      const dirName = item.path.split('/').pop()?.toLowerCase() || '';
      if (!['bin', 'obj', 'node_modules', '.git', 'packages', 'debug', 'release'].includes(dirName)) {
        await sleep(100); // Rate limiting
        const subFiles = await findCodeFiles(owner, repo, item.path, token, maxDepth, currentDepth + 1, maxFiles - files.length);
        files.push(...subFiles);
      }
    }
  }

  return files;
}

/**
 * Fetch raw file content
 */
async function fetchFileContent(downloadUrl: string, token?: string): Promise<string | null> {
  const headers: Record<string, string> = {
    'User-Agent': 'DevExpress-MCP-Crawler/1.0',
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const response = await fetch(downloadUrl, { headers });
    if (!response.ok) return null;
    return await response.text();
  } catch (error) {
    return null;
  }
}

/**
 * Extract class and method names from C# code
 */
function extractMetadata(code: string): { classes: string[]; methods: string[] } {
  const classRegex = /\bclass\s+(\w+)/g;
  const methodRegex = /\b(?:public|private|protected|internal)?\s*(?:static\s+)?(?:async\s+)?(?:override\s+)?(?:virtual\s+)?\w+\s+(\w+)\s*\(/g;

  const classes: string[] = [];
  const methods: string[] = [];

  let match;
  while ((match = classRegex.exec(code)) !== null) {
    if (!['class', 'new', 'return', 'public', 'private'].includes(match[1])) {
      classes.push(match[1]);
    }
  }

  while ((match = methodRegex.exec(code)) !== null) {
    if (!['if', 'for', 'while', 'switch', 'catch', 'using', 'new'].includes(match[1])) {
      methods.push(match[1]);
    }
  }

  return { classes: [...new Set(classes)], methods: [...new Set(methods)] };
}

/**
 * Extract description from code comments
 */
function extractDescription(code: string): string {
  const lines = code.split('\n').slice(0, 30);
  const comments = lines
    .filter((line) => line.includes('//') || line.includes('/*') || line.includes('*') || line.includes('///'))
    .map((line) => line.replace(/\/\*+|\*+\//g, '').replace(/^[\s/*]+/, '').replace(/\/\/\/?/, '').trim())
    .filter((line) => line.length > 5 && !line.includes('using') && !line.includes('namespace'))
    .join(' ');

  return comments.substring(0, 300) || '';
}

/**
 * Index a single file
 */
async function indexFile(
  owner: string,
  repo: string,
  filePath: string,
  downloadUrl: string,
  token?: string
): Promise<GitHubExample | null> {
  const content = await fetchFileContent(downloadUrl, token);

  if (!content || content.length < 50) {
    return null;
  }

  // Limit content size
  const maxSize = 8000;
  const truncatedContent = content.substring(0, maxSize);

  const { classes, methods } = extractMetadata(content);
  const description = extractDescription(content);

  // Determine language
  let language = 'csharp';
  if (filePath.endsWith('.aspx')) language = 'aspx';
  if (filePath.endsWith('.ascx')) language = 'ascx';

  const fileName = filePath.split('/').pop() || filePath;
  const title = fileName.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');

  return {
    id: `${owner}/${repo}:${filePath}`,
    type: 'code-file',
    title,
    filePath,
    repoName: `${owner}/${repo}`,
    repoUrl: `https://github.com/${owner}/${repo}`,
    fileUrl: `https://github.com/${owner}/${repo}/blob/main/${filePath}`,
    language,
    content: truncatedContent,
    contentPreview: truncatedContent.substring(0, 500),
    relatedClasses: classes.slice(0, 15),
    relatedMethods: methods.slice(0, 15),
    description,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Main crawler function
 */
export async function crawlGitHubExamples(options: {
  maxFiles?: number;
  githubToken?: string;
  delayMs?: number;
}): Promise<{ examples: GitHubExample[]; meta: GitHubMetadata }> {
  const { maxFiles = 100, githubToken, delayMs = 200 } = options;

  const examples: GitHubExample[] = [];
  const meta: GitHubMetadata = {
    totalExamples: 0,
    lastRefresh: new Date().toISOString(),
    repos: [],
  };

  console.error(`[GitHub Crawler] Starting indexing of ${DEVEXPRESS_REPOS.length} repos...`);
  console.error(`[GitHub Crawler] Using token: ${githubToken ? 'Yes' : 'No'}`);

  for (const { owner, repo, paths } of DEVEXPRESS_REPOS) {
    if (examples.length >= maxFiles) break;

    console.error(`[GitHub Crawler] Indexing ${owner}/${repo}...`);

    let filesIndexed = 0;

    for (const basePath of paths) {
      if (examples.length >= maxFiles) break;

      const files = await findCodeFiles(owner, repo, basePath, githubToken, 3, 0, Math.min(20, maxFiles - examples.length));

      for (const file of files) {
        if (examples.length >= maxFiles) break;

        console.error(`[GitHub Crawler] Processing ${file.path}...`);

        const example = await indexFile(owner, repo, file.path, file.download_url, githubToken);
        if (example) {
          examples.push(example);
          filesIndexed++;
        }

        await sleep(delayMs);
      }
    }

    if (filesIndexed > 0) {
      meta.repos.push({
        name: `${owner}/${repo}`,
        url: `https://github.com/${owner}/${repo}`,
        filesIndexed,
      });
      console.error(`[GitHub Crawler] Indexed ${filesIndexed} files from ${owner}/${repo}`);
    }

    await sleep(delayMs * 2);
  }

  meta.totalExamples = examples.length;

  console.error(`[GitHub Crawler] Finished. Indexed ${examples.length} examples from ${meta.repos.length} repos.`);

  return { examples, meta };
}

/**
 * Load GitHub examples from disk
 */
export function loadGitHubExamples(): GitHubExample[] {
  if (!existsSync(GITHUB_EXAMPLES_FILE)) {
    return [];
  }

  try {
    const data = readFileSync(GITHUB_EXAMPLES_FILE, 'utf-8');
    return JSON.parse(data) as GitHubExample[];
  } catch (error) {
    console.error('Failed to load GitHub examples:', error);
    return [];
  }
}

/**
 * Save GitHub examples to disk
 */
export function saveGitHubExamples(examples: GitHubExample[], meta: GitHubMetadata): void {
  try {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }

    writeFileSync(GITHUB_EXAMPLES_FILE, JSON.stringify(examples, null, 2));
    writeFileSync(GITHUB_META_FILE, JSON.stringify(meta, null, 2));

    console.error(`[GitHub Crawler] Saved ${examples.length} examples to ${GITHUB_EXAMPLES_FILE}`);
  } catch (error) {
    console.error('Failed to save GitHub examples:', error);
    throw error;
  }
}

/**
 * Load GitHub metadata from disk
 */
export function loadGitHubMeta(): GitHubMetadata | null {
  if (!existsSync(GITHUB_META_FILE)) {
    return null;
  }

  try {
    const data = readFileSync(GITHUB_META_FILE, 'utf-8');
    return JSON.parse(data) as GitHubMetadata;
  } catch (error) {
    console.error('Failed to load GitHub metadata:', error);
    return null;
  }
}
