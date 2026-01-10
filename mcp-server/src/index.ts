#!/usr/bin/env node

/**
 * One-Click MCP Server
 * 
 * A Model Context Protocol server for extracting web documentation.
 * Uses Puppeteer for full JavaScript rendering and robust content extraction.
 * 
 * Usage: npx one-click-mcp
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import puppeteer, { Browser, Page } from 'puppeteer';

// ============================================================================
// Browser Management
// ============================================================================

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.connected) {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
      ]
    });
  }
  return browser;
}

async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

// ============================================================================
// Page Ready Detection
// ============================================================================

async function waitForPageReady(page: Page, timeout: number = 30000): Promise<void> {
  // Wait for network to be idle (no requests for 500ms)
  await page.waitForNetworkIdle({ 
    idleTime: 500, 
    timeout 
  });

  // Additional wait for dynamic content hydration
  await page.evaluate(() => {
    return new Promise<void>((resolve) => {
      // Check if document is fully loaded
      if (document.readyState === 'complete') {
        // Give hydration frameworks a moment to finish
        setTimeout(resolve, 300);
      } else {
        window.addEventListener('load', () => setTimeout(resolve, 300));
      }
    });
  });
}

// ============================================================================
// Content Extraction
// ============================================================================

interface ExtractionResult {
  title: string;
  url: string;
  content: string;
  headings: { level: number; text: string }[];
  codeBlocks: { language: string; code: string }[];
  extractedAt: string;
}

async function extractContent(page: Page): Promise<ExtractionResult> {
  return await page.evaluate(() => {
    // --- Helper Functions ---
    
    function getPageTitle(): string {
      const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
      if (ogTitle) return ogTitle;
      const h1 = document.querySelector('h1');
      if (h1) return h1.textContent?.trim() || document.title;
      return document.title;
    }

    function isSkippableElement(el: Element): boolean {
      const skipTags = ['nav', 'header', 'footer', 'aside'];
      const skipClasses = ['nav', 'navigation', 'sidebar', 'footer', 'header', 'menu', 'toc', 'table-of-contents', 'ad', 'advertisement', 'cookie', 'popup', 'modal'];
      const skipRoles = ['navigation', 'banner', 'contentinfo', 'complementary'];

      const tagName = el.tagName.toLowerCase();
      if (skipTags.includes(tagName)) return true;

      const role = el.getAttribute('role');
      if (role && skipRoles.includes(role)) return true;

      const className = el.className.toString().toLowerCase();
      const id = el.id.toLowerCase();
      
      for (const skip of skipClasses) {
        if (className.includes(skip) || id.includes(skip)) return true;
      }
      return false;
    }

    function hasSubstantialContent(el: Element): boolean {
      const text = el.textContent || '';
      const wordCount = text.trim().split(/\s+/).length;
      return wordCount > 50;
    }

    function getMainContent(): Element {
      const selectors = [
        'main', 'article', '[role="main"]', '.main-content', '.content', '#content',
        '.post-content', '.article-content', '.documentation', '.docs-content',
        '.markdown-body', '.prose', '.theme-doc-markdown', // Docusaurus
        '.vp-doc', // VitePress
        '.md-content', // Material for MkDocs
        '.document', // ReadTheDocs
      ];

      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el && hasSubstantialContent(el)) return el;
      }

      // Fallback: find largest text-dense element
      const candidates = document.querySelectorAll('div, section');
      let bestElement: Element | null = null;
      let maxScore = 0;

      candidates.forEach(el => {
        if (isSkippableElement(el)) return;
        const text = el.textContent || '';
        const wordCount = text.trim().split(/\s+/).length;
        const paragraphs = el.querySelectorAll('p').length;
        const headings = el.querySelectorAll('h1, h2, h3, h4, h5, h6').length;
        const score = wordCount + (paragraphs * 10) + (headings * 20);
        
        if (score > maxScore) {
          maxScore = score;
          bestElement = el;
        }
      });

      return bestElement || document.body;
    }

    function extractHeadings(container: Element): { level: number; text: string }[] {
      const headings: { level: number; text: string }[] = [];
      container.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(el => {
        const level = parseInt(el.tagName.charAt(1));
        headings.push({
          level,
          text: el.textContent?.trim() || ''
        });
      });
      return headings;
    }

    function extractCodeBlocks(container: Element): { language: string; code: string }[] {
      const blocks: { language: string; code: string }[] = [];
      container.querySelectorAll('pre code, pre').forEach(el => {
        const codeEl = el.tagName === 'CODE' ? el : el.querySelector('code') || el;
        const classes = codeEl.className.split(' ');
        let language = '';
        
        for (const cls of classes) {
          if (cls.startsWith('language-')) {
            language = cls.replace('language-', '');
            break;
          }
          if (cls.startsWith('lang-')) {
            language = cls.replace('lang-', '');
            break;
          }
        }

        const code = codeEl.textContent?.trim() || '';
        if (code.length > 0) {
          blocks.push({ language, code });
        }
      });
      return blocks;
    }

    function convertToMarkdown(container: Element): string {
      const clone = container.cloneNode(true) as Element;
      
      // Remove unwanted elements
      ['nav', 'script', 'style', 'noscript', 'svg', 'iframe', '.ad', '.advertisement', '.cookie-banner']
        .forEach(sel => clone.querySelectorAll(sel).forEach(el => el.remove()));

      function processNode(node: Node): string {
        if (node.nodeType === Node.TEXT_NODE) {
          return node.textContent?.replace(/\s+/g, ' ') || '';
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return '';

        const el = node as Element;
        const tag = el.tagName.toLowerCase();
        
        if (el.getAttribute('hidden') !== null || el.getAttribute('aria-hidden') === 'true') {
          return '';
        }

        const children = Array.from(el.childNodes).map(processNode).join('');

        switch (tag) {
          case 'h1': return `\n\n# ${children.trim()}\n\n`;
          case 'h2': return `\n\n## ${children.trim()}\n\n`;
          case 'h3': return `\n\n### ${children.trim()}\n\n`;
          case 'h4': return `\n\n#### ${children.trim()}\n\n`;
          case 'h5': return `\n\n##### ${children.trim()}\n\n`;
          case 'h6': return `\n\n###### ${children.trim()}\n\n`;
          case 'p': return `\n\n${children.trim()}\n\n`;
          case 'br': return '\n';
          case 'strong': case 'b': return `**${children.trim()}**`;
          case 'em': case 'i': return `*${children.trim()}*`;
          case 'code':
            if (el.parentElement?.tagName.toLowerCase() !== 'pre') {
              return `\`${children.trim()}\``;
            }
            return children;
          case 'pre': {
            const codeEl = el.querySelector('code') || el;
            const lang = codeEl.className.split(' ').find(c => c.startsWith('language-'))?.replace('language-', '') || '';
            const code = codeEl.textContent?.trim() || '';
            return `\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
          }
          case 'a': {
            const href = el.getAttribute('href');
            const text = children.trim();
            if (href && text) {
              const absoluteUrl = new URL(href, window.location.href).href;
              return `[${text}](${absoluteUrl})`;
            }
            return text;
          }
          case 'ul': case 'ol': {
            const items = Array.from(el.children)
              .filter(child => child.tagName.toLowerCase() === 'li')
              .map((li, i) => {
                const prefix = tag === 'ol' ? `${i + 1}. ` : '- ';
                return prefix + processNode(li).trim();
              })
              .join('\n');
            return `\n\n${items}\n\n`;
          }
          case 'li': return children;
          case 'blockquote': {
            const lines = children.trim().split('\n').map(line => `> ${line}`).join('\n');
            return `\n\n${lines}\n\n`;
          }
          case 'hr': return '\n\n---\n\n';
          case 'script': case 'style': case 'noscript': case 'svg': return '';
          default: return children;
        }
      }

      return processNode(clone)
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    // --- Execute Extraction ---
    const mainContent = getMainContent();
    
    return {
      title: getPageTitle(),
      url: window.location.href,
      content: convertToMarkdown(mainContent),
      headings: extractHeadings(mainContent),
      codeBlocks: extractCodeBlocks(mainContent),
      extractedAt: new Date().toISOString()
    };
  });
}

// ============================================================================
// Section Detection
// ============================================================================

interface DetectedSection {
  title: string;
  url: string;
}

async function detectSections(page: Page): Promise<DetectedSection[]> {
  return await page.evaluate(() => {
    const sections: DetectedSection[] = [];
    const seen = new Set<string>();

    // Comprehensive sidebar selectors for popular doc frameworks
    const sidebarSelectors = [
      '.sidebar nav a', '.docs-sidebar a', '.toc a', '.table-of-contents a',
      'nav.docs a', '[class*="sidebar"] nav a', '[class*="sidebar"] ul a',
      'aside nav a', '.documentation-nav a', '.doc-nav a', '.docs-menu a',
      // Docusaurus
      '.theme-doc-sidebar-menu a', '.menu__link',
      // VitePress
      '.VPSidebar a', '.VPSidebarItem a', '.vp-sidebar a',
      // GitBook
      '.gitbook-navigation a', '[data-testid="toc"] a',
      // Material for MkDocs
      '.md-nav a', '.md-sidebar a',
      // ReadTheDocs
      '.rst-content .toctree a', '.wy-menu a',
      // Nextra
      '[data-nextra-toc] a',
      // General patterns
      '[data-docs-sidebar] a', '.nav-link',
    ];

    for (const selector of sidebarSelectors) {
      try {
        const links = document.querySelectorAll(selector);
        if (links.length > 2) {
          links.forEach(link => {
            const anchor = link as HTMLAnchorElement;
            const href = anchor.href;
            const title = anchor.textContent?.trim();
            
            if (href && title && href.startsWith(window.location.origin) && !seen.has(href)) {
              seen.add(href);
              sections.push({ title, url: href });
            }
          });
          
          if (sections.length > 0) break;
        }
      } catch {
        // Selector failed, try next
      }
    }

    return sections;
  });
}

// ============================================================================
// MCP Server Setup
// ============================================================================

const server = new McpServer({
  name: 'one-click-mcp',
  version: '1.0.0',
});

// Tool: Extract documentation from a URL
server.tool(
  'extract_documentation',
  'Extracts documentation content from a URL. Returns clean markdown with headings and code blocks preserved. Uses headless Chrome to handle JavaScript-rendered content.',
  {
    url: z.string().url().describe('The URL of the documentation page to extract'),
    waitTime: z.number().optional().describe('Additional wait time in ms after page load (default: 0)'),
  },
  async ({ url, waitTime = 0 }) => {
    let page: Page | null = null;
    
    try {
      const browserInstance = await getBrowser();
      page = await browserInstance.newPage();
      
      // Set a reasonable viewport
      await page.setViewport({ width: 1280, height: 800 });
      
      // Block unnecessary resources for faster loading
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const resourceType = request.resourceType();
        if (['image', 'media', 'font'].includes(resourceType)) {
          request.abort();
        } else {
          request.continue();
        }
      });

      // Navigate to URL
      await page.goto(url, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000 
      });

      // Wait for page to be fully ready
      await waitForPageReady(page);

      // Additional wait if specified
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      // Extract content
      const result = await extractContent(page);

      return {
        content: [
          {
            type: 'text' as const,
            text: `# ${result.title}\n\n> **Source:** ${result.url}\n> **Extracted:** ${result.extractedAt}\n\n${result.content}`
          }
        ]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error extracting documentation from ${url}: ${errorMessage}`
          }
        ],
        isError: true
      };
    } finally {
      if (page) {
        try {
          await page.close();
        } catch {
          // Page may already be closed
        }
      }
    }
  }
);

// Tool: List documentation sections
server.tool(
  'list_documentation_sections',
  'Detects and lists all documentation sections/pages found in the sidebar or navigation of a documentation site. Useful for discovering available pages before extraction.',
  {
    url: z.string().url().describe('The URL of a documentation page (will detect sibling pages from navigation)'),
  },
  async ({ url }) => {
    let page: Page | null = null;
    
    try {
      const browserInstance = await getBrowser();
      page = await browserInstance.newPage();
      
      await page.setViewport({ width: 1280, height: 800 });
      
      await page.goto(url, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000 
      });

      await waitForPageReady(page);
      
      const sections = await detectSections(page);

      if (sections.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `No documentation sections detected on ${url}. This might be a single-page doc or uses an unsupported navigation structure.`
            }
          ]
        };
      }

      const sectionList = sections
        .map((s, i) => `${i + 1}. [${s.title}](${s.url})`)
        .join('\n');

      return {
        content: [
          {
            type: 'text' as const,
            text: `Found ${sections.length} documentation sections:\n\n${sectionList}`
          }
        ]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error detecting sections on ${url}: ${errorMessage}`
          }
        ],
        isError: true
      };
    } finally {
      if (page) {
        try {
          await page.close();
        } catch {
          // Page may already be closed
        }
      }
    }
  }
);

// Tool: Extract multiple sections
server.tool(
  'extract_multiple_sections',
  'Extracts content from multiple documentation URLs. Returns combined markdown with all sections.',
  {
    urls: z.array(z.string().url()).describe('Array of documentation URLs to extract'),
  },
  async ({ urls }) => {
    const results: string[] = [];
    const browserInstance = await getBrowser();
    
    for (const url of urls) {
      let page: Page | null = null;
      
      try {
        page = await browserInstance.newPage();
        await page.setViewport({ width: 1280, height: 800 });
        
        await page.setRequestInterception(true);
        page.on('request', (request) => {
          const resourceType = request.resourceType();
          if (['image', 'media', 'font'].includes(resourceType)) {
            request.abort();
          } else {
            request.continue();
          }
        });

        await page.goto(url, { 
          waitUntil: 'domcontentloaded',
          timeout: 30000 
        });

        await waitForPageReady(page);
        
        const result = await extractContent(page);
        
        results.push(`# ${result.title}\n\n> **Source:** ${result.url}\n\n${result.content}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        results.push(`# Error: ${url}\n\nFailed to extract: ${errorMessage}`);
      } finally {
        if (page) {
          try {
            await page.close();
          } catch {
            // Page may already be closed
          }
        }
      }
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: results.join('\n\n---\n\n')
        }
      ]
    };
  }
);

// ============================================================================
// Server Lifecycle
// ============================================================================

async function main() {
  const transport = new StdioServerTransport();
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    await closeBrowser();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    await closeBrowser();
    process.exit(0);
  });

  await server.connect(transport);
}

main().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
