import type { ExtractedContent, Heading, CodeBlock, DetectedSection, ExtractMessage, SectionsMessage } from '../types';

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message: ExtractMessage | SectionsMessage, _sender, sendResponse) => {
  if (message.type === 'EXTRACT_PAGE') {
    extractPage()
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep channel open for async response
  }

  if (message.type === 'GET_SECTIONS') {
    const sections = detectDocSections();
    sendResponse({ success: true, sections });
    return true;
  }
});

// Main extraction function
async function extractPage(): Promise<ExtractedContent> {
  const title = getPageTitle();
  const mainContent = getMainContent();
  const headings = extractHeadings(mainContent);
  const codeBlocks = extractCodeBlocks(mainContent);
  const content = convertToMarkdown(mainContent);

  return {
    title,
    url: window.location.href,
    extractedAt: new Date().toISOString(),
    content,
    headings,
    codeBlocks
  };
}

// Get page title
function getPageTitle(): string {
  // Try meta title first, then h1, then document title
  const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
  if (ogTitle) return ogTitle;

  const h1 = document.querySelector('h1');
  if (h1) return h1.textContent?.trim() || document.title;

  return document.title;
}

// Find main content area, skip nav/footer/sidebar
function getMainContent(): Element {
  // Priority order for main content detection
  const selectors = [
    'main',
    'article',
    '[role="main"]',
    '.main-content',
    '.content',
    '#content',
    '.post-content',
    '.article-content',
    '.documentation',
    '.docs-content',
    '.markdown-body', // GitHub
    '.prose', // Tailwind prose
  ];

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el && hasSubstantialContent(el)) {
      return el;
    }
  }

  // Fallback: find largest text-dense element
  return findLargestContentArea() || document.body;
}

// Check if element has enough content to be considered main
function hasSubstantialContent(el: Element): boolean {
  const text = el.textContent || '';
  const wordCount = text.trim().split(/\s+/).length;
  return wordCount > 50;
}

// Heuristic: find the element with the most text content
function findLargestContentArea(): Element | null {
  const candidates = document.querySelectorAll('div, section');
  let bestElement: Element | null = null;
  let maxScore = 0;

  candidates.forEach(el => {
    // Skip navigation, headers, footers, sidebars
    if (isSkippableElement(el)) return;

    const text = el.textContent || '';
    const wordCount = text.trim().split(/\s+/).length;
    const paragraphs = el.querySelectorAll('p').length;
    const headings = el.querySelectorAll('h1, h2, h3, h4, h5, h6').length;
    
    // Score based on content density
    const score = wordCount + (paragraphs * 10) + (headings * 20);
    
    if (score > maxScore) {
      maxScore = score;
      bestElement = el;
    }
  });

  return bestElement;
}

// Elements to skip during extraction
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

// Extract headings with hierarchy
function extractHeadings(container: Element): Heading[] {
  const headings: Heading[] = [];
  const headingEls = container.querySelectorAll('h1, h2, h3, h4, h5, h6');
  
  headingEls.forEach(el => {
    const level = parseInt(el.tagName.charAt(1));
    headings.push({
      level,
      text: el.textContent?.trim() || '',
      id: el.id || undefined
    });
  });

  return headings;
}

// Extract code blocks with language hints
function extractCodeBlocks(container: Element): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const codeEls = container.querySelectorAll('pre code, pre');
  
  codeEls.forEach(el => {
    // Check if this is a pre containing code, not just pre
    const codeEl = el.tagName === 'CODE' ? el : el.querySelector('code') || el;
    
    // Try to detect language from class
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
      // Common language class patterns
      const langMatch = cls.match(/^(javascript|typescript|python|ruby|go|rust|java|cpp|c|bash|shell|json|yaml|html|css|sql|kotlin|swift)$/i);
      if (langMatch) {
        language = langMatch[1].toLowerCase();
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

// Convert DOM content to Markdown
function convertToMarkdown(container: Element): string {
  const clone = container.cloneNode(true) as Element;
  
  // Remove unwanted elements from clone
  const removeSelectors = ['nav', 'script', 'style', 'noscript', 'svg', 'iframe', '.ad', '.advertisement', '.cookie-banner'];
  removeSelectors.forEach(sel => {
    clone.querySelectorAll(sel).forEach(el => el.remove());
  });

  return processNode(clone);
}

// Recursively process DOM nodes to Markdown
function processNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent?.replace(/\s+/g, ' ') || '';
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }

  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  
  // Skip hidden elements
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
    
    case 'strong':
    case 'b': return `**${children.trim()}**`;
    
    case 'em':
    case 'i': return `*${children.trim()}*`;
    
    case 'code':
      // Inline code (not in pre)
      if (el.parentElement?.tagName.toLowerCase() !== 'pre') {
        return `\`${children.trim()}\``;
      }
      return children;
    
    case 'pre': {
      const codeEl = el.querySelector('code') || el;
      const lang = detectLanguageFromElement(codeEl);
      const code = codeEl.textContent?.trim() || '';
      return `\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
    }
    
    case 'a': {
      const href = el.getAttribute('href');
      const text = children.trim();
      if (href && text) {
        // Make relative URLs absolute
        const absoluteUrl = new URL(href, window.location.href).href;
        return `[${text}](${absoluteUrl})`;
      }
      return text;
    }
    
    case 'ul':
    case 'ol': {
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
    
    case 'table': return convertTableToMarkdown(el);
    
    case 'img': {
      const alt = el.getAttribute('alt') || 'image';
      const src = el.getAttribute('src');
      if (src) {
        const absoluteSrc = new URL(src, window.location.href).href;
        return `![${alt}](${absoluteSrc})`;
      }
      return '';
    }
    
    case 'hr': return '\n\n---\n\n';
    
    // Skip these entirely
    case 'script':
    case 'style':
    case 'noscript':
    case 'svg':
      return '';
    
    default:
      return children;
  }
}

// Detect language from code element
function detectLanguageFromElement(el: Element): string {
  const classes = el.className.split(' ');
  for (const cls of classes) {
    if (cls.startsWith('language-')) return cls.replace('language-', '');
    if (cls.startsWith('lang-')) return cls.replace('lang-', '');
  }
  return '';
}

// Convert HTML table to Markdown table
function convertTableToMarkdown(table: Element): string {
  const rows = table.querySelectorAll('tr');
  if (rows.length === 0) return '';

  const result: string[] = [];
  let headerProcessed = false;

  rows.forEach((row, rowIndex) => {
    const cells = row.querySelectorAll('th, td');
    const cellTexts = Array.from(cells).map(cell => cell.textContent?.trim() || '');
    
    result.push('| ' + cellTexts.join(' | ') + ' |');
    
    // Add separator after header row
    if (!headerProcessed && (row.querySelector('th') || rowIndex === 0)) {
      result.push('| ' + cellTexts.map(() => '---').join(' | ') + ' |');
      headerProcessed = true;
    }
  });

  return '\n\n' + result.join('\n') + '\n\n';
}

// Detect documentation sections for batch extraction
function detectDocSections(): DetectedSection[] {
  const sections: DetectedSection[] = [];
  const currentUrl = normalizeUrl(window.location.href);
  const seen = new Set<string>();
  
  // Comprehensive sidebar selectors for popular documentation frameworks
  const sidebarSelectors = [
    // === Generic patterns ===
    '.sidebar nav a',
    '.docs-sidebar a',
    '.toc a',
    '.table-of-contents a',
    'nav.docs a',
    '[class*="sidebar"] nav a',
    '[class*="sidebar"] ul a',
    'aside nav a',
    '.documentation-nav a',
    '.doc-nav a',
    '.docs-menu a',
    '[data-docs-sidebar] a',
    '.nav-link',
    
    // === Docusaurus (v1 and v2) ===
    '.theme-doc-sidebar-menu a',
    '.menu__link',
    '.docSidebarContainer a',
    '[class*="docSidebar"] a',
    '.docs-sidebar-nav a',
    
    // === VitePress ===
    '.VPSidebar a',
    '.VPSidebarItem a',
    '.vp-sidebar a',
    '.VPNavBar a',
    '.sidebar-links a',
    
    // === GitBook ===
    '.gitbook-navigation a',
    '[data-testid="toc"] a',
    '.css-175oi2r a', // GitBook dynamic classes
    '.sidebar-navigation a',
    
    // === Material for MkDocs ===
    '.md-nav a',
    '.md-sidebar a',
    '.md-nav__link',
    
    // === ReadTheDocs / Sphinx ===
    '.rst-content .toctree a',
    '.wy-menu a',
    '.wy-nav-side a',
    '.sphinxsidebar a',
    
    // === Nextra ===
    '[data-nextra-toc] a',
    '.nextra-sidebar a',
    'nav.nextra-toc a',
    
    // === Mintlify ===
    '[data-sidebar] a',
    '.mintlify-sidebar a',
    
    // === Notion-based docs ===
    '.notion-table_of_contents a',
    
    // === Docsify ===
    '.sidebar-nav a',
    
    // === Hugo Docsy ===
    '#td-sidebar-menu a',
    '.td-sidebar-nav a',
    
    // === Starlight (Astro) ===
    '[data-sidebar] a',
    '.sidebar-content a',
    
    // === Generic Bootstrap/Tailwind docs ===
    '.bd-sidebar a',
    '.docs-toc a',
    '#docs-sidebar a',
    '.doc-sidebar a',
  ];

  // Strategy 1: Try specific selectors first
  for (const selector of sidebarSelectors) {
    try {
      const links = document.querySelectorAll(selector);
      if (links.length > 2) {
        collectLinks(links, sections, seen, currentUrl);
        if (sections.length > 3) break; // Found good results
      }
    } catch {
      // Invalid selector, skip
    }
  }

  // Strategy 2: Look for nav elements with many internal links
  if (sections.length < 3) {
    const navElements = document.querySelectorAll('nav, aside, [role="navigation"]');
    navElements.forEach(nav => {
      if (isSkippableNav(nav)) return;
      const links = nav.querySelectorAll('a[href]');
      if (links.length > 5) {
        collectLinks(links, sections, seen, currentUrl);
      }
    });
  }

  // Strategy 3: Look for lists with internal links (common pattern)
  if (sections.length < 3) {
    const lists = document.querySelectorAll('ul, ol');
    lists.forEach(list => {
      const links = list.querySelectorAll('a[href]');
      const internalLinks = Array.from(links).filter(a => {
        const href = (a as HTMLAnchorElement).href;
        return href && href.startsWith(window.location.origin);
      });
      
      // If most links are internal and there are several, likely a nav
      if (internalLinks.length > 5 && internalLinks.length / links.length > 0.8) {
        collectLinks(links, sections, seen, currentUrl);
      }
    });
  }

  return sections;
}

// Helper: Normalize URL for comparison (remove hash, trailing slash)
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    let pathname = parsed.pathname;
    if (pathname.endsWith('/') && pathname.length > 1) {
      pathname = pathname.slice(0, -1);
    }
    parsed.pathname = pathname;
    return parsed.toString();
  } catch {
    return url;
  }
}

// Helper: Check if nav element should be skipped (header nav, footer, etc.)
function isSkippableNav(el: Element): boolean {
  const skipPatterns = ['header', 'footer', 'top-nav', 'main-nav', 'navbar', 'footer-nav'];
  const className = el.className.toString().toLowerCase();
  const id = el.id.toLowerCase();
  const role = el.getAttribute('role');
  
  // Skip header/footer navigations
  if (role === 'banner' || role === 'contentinfo') return true;
  
  for (const pattern of skipPatterns) {
    if (className.includes(pattern) || id.includes(pattern)) return true;
  }
  
  // Skip if parent is header/footer
  const parent = el.parentElement;
  if (parent) {
    const parentTag = parent.tagName.toLowerCase();
    if (parentTag === 'header' || parentTag === 'footer') return true;
  }
  
  return false;
}

// Helper: Collect links from NodeList into sections array
function collectLinks(
  links: NodeListOf<Element>,
  sections: DetectedSection[],
  seen: Set<string>,
  currentUrl: string
): void {
  links.forEach(link => {
    const anchor = link as HTMLAnchorElement;
    const href = anchor.href;
    const title = anchor.textContent?.trim();
    
    if (!href || !title || title.length < 2) return;
    
    // Only internal links
    if (!href.startsWith(window.location.origin)) return;
    
    // Skip anchors on same page, downloads, external protocols
    if (href.includes('#') && normalizeUrl(href) === currentUrl) return;
    if (href.match(/\.(pdf|zip|tar|gz|exe|dmg|pkg)$/i)) return;
    
    const normalizedHref = normalizeUrl(href);
    if (seen.has(normalizedHref)) return;
    
    seen.add(normalizedHref);
    sections.push({
      title,
      url: href,
      isCurrentPage: normalizedHref === currentUrl
    });
  });
}

console.log('[One-Click Extract] Content script loaded');
