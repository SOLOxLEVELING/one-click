import type { ExportFormat, ExtractedContent, DetectedSection } from '../types';

// State
let selectedFormat: ExportFormat = 'markdown';
let detectedSections: DetectedSection[] = [];

// DOM Elements
const formatButtons = document.querySelectorAll<HTMLButtonElement>('.format-btn');
const extractPageBtn = document.getElementById('extract-page') as HTMLButtonElement;
const sectionsPanel = document.getElementById('sections-panel') as HTMLElement;
const sectionsList = document.getElementById('sections-list') as HTMLElement;
const sectionCount = document.getElementById('section-count') as HTMLElement;
const extractSelectedBtn = document.getElementById('extract-selected') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLElement;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  setupFormatButtons();
  setupExtractButton();
  setupExtractSelectedButton();
  await detectSections();
});

// Format button handling
function setupFormatButtons() {
  formatButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      formatButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedFormat = btn.dataset.format as ExportFormat;
    });
  });
}

// Extract current page
function setupExtractButton() {
  extractPageBtn.addEventListener('click', async () => {
    try {
      setLoading(extractPageBtn, true);
      hideStatus();
      
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) throw new Error('No active tab');

      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'EXTRACT_PAGE',
        format: selectedFormat
      });

      if (response.success && response.data) {
        await downloadContent(response.data, selectedFormat);
        showStatus('Extracted successfully!', 'success');
      } else {
        throw new Error(response.error || 'Extraction failed');
      }
    } catch (error) {
      console.error('Extraction error:', error);
      showStatus(error instanceof Error ? error.message : 'Extraction failed', 'error');
    } finally {
      setLoading(extractPageBtn, false);
    }
  });
}

// Detect documentation sections
async function detectSections() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.id) return;

    const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_SECTIONS' });
    
    if (response.success && response.sections && response.sections.length > 0) {
      detectedSections = response.sections;
      renderSections();
      sectionsPanel.classList.remove('hidden');
    }
  } catch (error) {
    // Sections detection is optional, don't show error
    console.log('No sections detected');
  }
}

// Render sections list
function renderSections() {
  sectionCount.textContent = `(${detectedSections.length})`;
  
  sectionsList.innerHTML = detectedSections.map((section, index) => `
    <div class="section-item ${section.isCurrentPage ? 'current' : ''}">
      <input type="checkbox" id="section-${index}" ${section.isCurrentPage ? 'checked' : ''}>
      <label for="section-${index}">${escapeHtml(section.title)}</label>
    </div>
  `).join('');
}

// Extract selected sections
function setupExtractSelectedButton() {
  extractSelectedBtn.addEventListener('click', async () => {
    const selectedIndices: number[] = [];
    sectionsList.querySelectorAll('input[type="checkbox"]:checked').forEach((checkbox, index) => {
      selectedIndices.push(index);
    });

    if (selectedIndices.length === 0) {
      showStatus('No sections selected', 'error');
      return;
    }

    try {
      setLoading(extractSelectedBtn, true);
      hideStatus();

      const selectedSections = selectedIndices.map(i => detectedSections[i]);
      
      // For now, extract each section sequentially
      const allContent: ExtractedContent[] = [];
      
      for (const section of selectedSections) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab.id) continue;

        // Navigate to section URL and extract
        if (!section.isCurrentPage) {
          await chrome.tabs.update(tab.id, { url: section.url });
          // Wait for page load
          await new Promise(resolve => setTimeout(resolve, 1500));
        }

        const response = await chrome.tabs.sendMessage(tab.id, {
          type: 'EXTRACT_PAGE',
          format: selectedFormat
        });

        if (response.success && response.data) {
          allContent.push(response.data);
        }
      }

      if (allContent.length > 0) {
        await downloadBatchContent(allContent, selectedFormat);
        showStatus(`Extracted ${allContent.length} sections!`, 'success');
      }
    } catch (error) {
      console.error('Batch extraction error:', error);
      showStatus('Batch extraction failed', 'error');
    } finally {
      setLoading(extractSelectedBtn, false);
    }
  });
}

// Download helpers
async function downloadContent(content: ExtractedContent, format: ExportFormat) {
  const filename = sanitizeFilename(content.title);
  const timestamp = new Date().toISOString().split('T')[0];

  if (format === 'markdown' || format === 'both') {
    const md = formatAsMarkdown(content);
    downloadFile(`${filename}_${timestamp}.md`, md, 'text/markdown');
  }

  if (format === 'json' || format === 'both') {
    const json = JSON.stringify(content, null, 2);
    downloadFile(`${filename}_${timestamp}.json`, json, 'application/json');
  }
}

async function downloadBatchContent(contents: ExtractedContent[], format: ExportFormat) {
  const timestamp = new Date().toISOString().split('T')[0];
  const firstTitle = contents[0]?.title || 'extracted';
  const filename = sanitizeFilename(firstTitle) + '_batch';

  if (format === 'markdown' || format === 'both') {
    const md = contents.map(c => formatAsMarkdown(c)).join('\n\n---\n\n');
    downloadFile(`${filename}_${timestamp}.md`, md, 'text/markdown');
  }

  if (format === 'json' || format === 'both') {
    const json = JSON.stringify({ 
      extractedAt: new Date().toISOString(),
      totalSections: contents.length,
      sections: contents 
    }, null, 2);
    downloadFile(`${filename}_${timestamp}.json`, json, 'application/json');
  }
}

function formatAsMarkdown(content: ExtractedContent): string {
  return `# ${content.title}

> **Source:** ${content.url}
> **Extracted:** ${content.extractedAt}

${content.content}`;
}

function downloadFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  
  chrome.downloads.download({
    url: url,
    filename: filename,
    saveAs: false
  });
}

// UI Helpers
function setLoading(button: HTMLButtonElement, loading: boolean) {
  button.disabled = loading;
  button.classList.toggle('loading', loading);
}

function showStatus(message: string, type: 'success' | 'error') {
  statusEl.classList.remove('hidden', 'error');
  if (type === 'error') statusEl.classList.add('error');
  
  const icon = statusEl.querySelector('.status-icon') as HTMLElement;
  const text = statusEl.querySelector('.status-text') as HTMLElement;
  
  icon.textContent = type === 'success' ? '✓' : '✕';
  text.textContent = message;

  // Auto-hide after 3 seconds
  setTimeout(hideStatus, 3000);
}

function hideStatus() {
  statusEl.classList.add('hidden');
}

function sanitizeFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, 50);
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
