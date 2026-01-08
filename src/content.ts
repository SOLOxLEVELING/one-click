import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';

// --- Toast Logic ---
const createToast = () => {
  let toast = document.getElementById('context-snap-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'context-snap-toast';
    document.body.appendChild(toast);
  }
  return toast;
};

const showToast = (message: string, isError = false) => {
  const toast = createToast();
  toast.textContent = message;
  toast.className = isError ? 'error show' : 'show';
  
  setTimeout(() => {
    toast.className = toast.className.replace('show', '').trim();
  }, 2000);
};

// --- Extraction Logic ---
const getFormattedTimestamp = () => {
  return new Date().toISOString();
};

const generateHeader = (url: string) => {
  return `[URL: ${url}] | [Date: ${getFormattedTimestamp()}] INSTRUCTION: The following text is provided as raw context for our current session. Please parse this information, acknowledge its receipt, and wait for my specific queries regarding its content.\n\n`;
};

const extractContent = () => {
  try {
    // 1. Check for PDF
    if (document.contentType === 'application/pdf' || window.location.href.endsWith('.pdf')) {
      showToast('Not supported on PDFs', true);
      return;
    }

    // 2. Readability
    const documentClone = document.cloneNode(true) as Document;
    const reader = new Readability(documentClone);
    const article = reader.parse();

    let contentHtml = '';
    let title = document.title;

    if (article) {
      contentHtml = article.content || document.body.innerHTML;
      title = article.title || document.title;
    } else {
      // Fallback
      contentHtml = document.body.innerHTML;
    }

    // 3. Turndown (HTML -> GFM)
    const turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced'
    });
    
    // Preserve code blocks with better fencing
    turndownService.addRule('pre-code', {
        filter: ['pre'],
        replacement: function (content, _node) {
            // handle cases where pre contains code
            return '```\n' + content.trim() + '\n```\n\n';
        }
    });

    const markdown = turndownService.turndown(contentHtml);
    const header = generateHeader(window.location.href);
    const finalPayload = `${header}# ${title}\n\n${markdown}`;

    // 4. Copy to Clipboard
    navigator.clipboard.writeText(finalPayload).then(() => {
      showToast('Context Snapped!');
    }).catch(err => {
      console.error('Clipboard write failed', err);
      showToast('Clipboard Error', true);
    });

  } catch (error) {
    console.error('Extraction failed', error);
    showToast('Extraction Failed', true);
  }
};

// --- Listener ---
chrome.runtime.onMessage.addListener((request: any, _sender: chrome.runtime.MessageSender, _sendResponse: (response?: any) => void) => {
  if (request.action === 'snap') {
    extractContent();
  }
  return true; 
});
