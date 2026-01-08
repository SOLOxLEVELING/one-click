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
  const currentUrl = window.location.href;
  
  // Common documentation sidebar/nav selectors
  const sidebarSelectors = [
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
  ];

  for (const selector of sidebarSelectors) {
    const links = document.querySelectorAll(selector);
    if (links.length > 2) {
      links.forEach(link => {
        const anchor = link as HTMLAnchorElement;
        const href = anchor.href;
        const title = anchor.textContent?.trim();
        
        // Only include internal documentation links
        if (href && title && href.startsWith(window.location.origin)) {
          // Avoid duplicates
          if (!sections.find(s => s.url === href)) {
            sections.push({
              title,
              url: href,
              isCurrentPage: href === currentUrl
            });
          }
        }
      });
      
      // If we found sections, stop looking
      if (sections.length > 0) break;
    }
  }

  return sections;
}

console.log('[One-Click Extract] Content script loaded');
