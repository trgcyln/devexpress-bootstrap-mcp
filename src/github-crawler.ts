import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname } from 'path';

const DATA_DIR = './data';
const GITHUB_EXAMPLES_FILE = `${DATA_DIR}/github-examples.json`;
const GITHUB_META_FILE = `${DATA_DIR}/github-meta.json`;

export interface GitHubExample {
  id: string;
  type: 'example' | 'code-file';
  title: string;
  filePath: string;
  repoName: string;
  repoUrl: string;
  fileUrl: string;
  language: string; // 'csharp', 'aspx', 'ascx'
  content: string; // truncated code
  contentPreview: string; // first 500 chars
  relatedClasses: string[]; // class names mentioned
  relatedMethods: string[]; // method names
  description: string; // from comments or readme
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

// Common DevExpress example repositories
const DEVEXPRESS_EXAMPLE_REPOS = [
  'devexpress/devextreme-angular-template-gallery',
  'devexpress/devextreme-react-template-gallery',
  'devexpress/devextreme-vue-template-gallery',
  'devexpress-examples/devextreme-examples',
  'devexpress-examples/asp-net-bootstrap-examples',
  'devexpress-examples/asp-net-core-free-ui-templates',
];

/**
 * Fetches raw content from GitHub using the API
 */
async function fetchGitHubContent(
  owner: string,
  repo: string,
  path: string,
  token?: string
): Promise<string | null> {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3.raw',
  };

  if (token) {
    headers.Authorization = `token ${token}`;
  }

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) return null;
    return await response.text();
  } catch (error) {
    console.error(`Failed to fetch ${url}:`, error);
    return null;
  }
}

/**
 * Search GitHub API for C# files in a repository
 */
async function searchRepoFiles(
  owner: string,
  repo: string,
  language: string,
  token?: string,
  limit: number = 50
): Promise<Array<{ path: string; url: string }>> {
  const query = `repo:${owner}/${repo} language:${language}`;
  const url = `https://api.github.com/search/code?q=${encodeURIComponent(query)}&per_page=${limit}`;

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
  };

  if (token) {
    headers.Authorization = `token ${token}`;
  }

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      console.error(`GitHub API error: ${response.status} ${response.statusText}`);
      return [];
    }

    const data = (await response.json()) as { items?: Array<{ path: string; html_url: string }> };
    return (
      data.items?.map((item: { path: string; html_url: string }) => ({
        path: item.path,
        url: item.html_url,
      })) || []
    );
  } catch (error) {
    console.error('GitHub API search failed:', error);
    return [];
  }
}

/**
 * Extract class and method names from C# code
 */
function extractMetadata(code: string): { classes: string[]; methods: string[] } {
  const classRegex = /\bclass\s+(\w+)/g;
  const methodRegex = /\b(?:public|private|protected)?\s+\w+\s+(\w+)\s*\(/g;

  const classes: string[] = [];
  const methods: string[] = [];

  let match;
  while ((match = classRegex.exec(code)) !== null) {
    classes.push(match[1]);
  }

  while ((match = methodRegex.exec(code)) !== null) {
    methods.push(match[1]);
  }

  return { classes, methods };
}

/**
 * Extract description from code comments
 */
function extractDescription(code: string): string {
  const lines = code.split('\n').slice(0, 20);
  const comments = lines
    .filter((line) => line.includes('//') || line.includes('/*') || line.includes('*'))
    .map((line) => line.replace(/\/\*+|\*+\//g, '').replace(/^[\s/*]+/, '').trim())
    .filter((line) => line.length > 0 && !line.includes('using'))
    .join(' ');

  return comments.substring(0, 200) || code.substring(0, 200);
}

/**
 * Index a single C# file
 */
async function indexFile(
  owner: string,
  repo: string,
  filePath: string,
  fileUrl: string,
  token?: string
): Promise<GitHubExample | null> {
  const content = await fetchGitHubContent(owner, repo, filePath, token);

  if (!content || content.length === 0) {
    return null;
  }

  // Limit content size for storage
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
    id: `${repo}:${filePath}`,
    type: 'code-file',
    title,
    filePath,
    repoName: repo,
    repoUrl: `https://github.com/${owner}/${repo}`,
    fileUrl,
    language,
    content: truncatedContent,
    contentPreview: truncatedContent.substring(0, 500),
    relatedClasses: classes.slice(0, 10),
    relatedMethods: methods.slice(0, 10),
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
  const { maxFiles = 100, githubToken, delayMs = 100 } = options;

  const examples: GitHubExample[] = [];
  const meta: GitHubMetadata = {
    totalExamples: 0,
    lastRefresh: new Date().toISOString(),
    repos: [],
  };

  console.error(`[GitHub Crawler] Starting indexing of ${DEVEXPRESS_EXAMPLE_REPOS.length} repos...`);

  for (const repoPath of DEVEXPRESS_EXAMPLE_REPOS) {
    const [owner, repo] = repoPath.split('/');
    console.error(`[GitHub Crawler] Indexing ${owner}/${repo}...`);

    let filesIndexed = 0;
    const repoExamples: GitHubExample[] = [];

    // Search for C# files
    for (const lang of ['csharp', 'markup']) {
      if (examples.length >= maxFiles) break;

      const files = await searchRepoFiles(owner, repo, lang, githubToken, 30);

      for (const file of files) {
        if (examples.length >= maxFiles) break;

        const example = await indexFile(owner, repo, file.path, file.url, githubToken);
        if (example) {
          examples.push(example);
          repoExamples.push(example);
          filesIndexed++;
          console.error(`[GitHub Crawler] Indexed ${file.path}`);

          // Rate limiting
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    if (filesIndexed > 0) {
      meta.repos.push({
        name: repo,
        url: `https://github.com/${owner}/${repo}`,
        filesIndexed,
      });
    }

    // Delay between repos
    await new Promise((resolve) => setTimeout(resolve, delayMs * 2));
  }

  meta.totalExamples = examples.length;

  console.error(`[GitHub Crawler] Finished. Indexed ${examples.length} examples.`);

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
    // Ensure data dir exists
    if (!existsSync(DATA_DIR)) {
      throw new Error(`Data directory not found: ${DATA_DIR}`);
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
