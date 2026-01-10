import type { ExportFormat, ExtractedContent, DetectedSection } from '../types';

// State
let selectedFormat: ExportFormat = 'markdown';
let detectedSections: DetectedSection[] = [];
let currentDomain: string = '';

// DOM Elements
const formatButtons = document.querySelectorAll<HTMLButtonElement>('.format-btn');
const extractBtn = document.getElementById('extract-btn') as HTMLButtonElement;
const sectionsPanel = document.getElementById('sections-panel') as HTMLElement;
const sectionsList = document.getElementById('sections-list') as HTMLElement;
const sectionCount = document.getElementById('section-count') as HTMLElement;
const selectAllCheckbox = document.getElementById('select-all') as HTMLInputElement;
const statusEl = document.getElementById('status') as HTMLElement;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  setupFormatButtons();
  setupExtractButton();
  setupSelectAllToggle();
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

// Select All toggle
function setupSelectAllToggle() {
  selectAllCheckbox.addEventListener('change', () => {
    const isChecked = selectAllCheckbox.checked;
    const checkboxes = sectionsList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    checkboxes.forEach(cb => {
      cb.checked = isChecked;
    });
    updateSelectedCount();
    updateButtonText();
  });

  // Update Select All state when individual checkboxes change
  sectionsList.addEventListener('change', (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') {
      updateSelectAllState();
      updateSelectedCount();
      updateButtonText();
    }
  });
}

// Update Select All checkbox based on individual checkboxes
function updateSelectAllState() {
  const checkboxes = sectionsList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  const checkedCount = sectionsList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked').length;
  
  if (checkedCount === 0) {
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = false;
  } else if (checkedCount === checkboxes.length) {
    selectAllCheckbox.checked = true;
    selectAllCheckbox.indeterminate = false;
  } else {
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = true;
  }
}

// Update selected count display
function updateSelectedCount() {
  const checkedCount = getSelectedCount();
  sectionCount.textContent = `(${checkedCount}/${detectedSections.length})`;
}

// Get count of selected sections
function getSelectedCount(): number {
  return sectionsList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked').length;
}

// Get selected section indices
function getSelectedIndices(): number[] {
  const checkedBoxes = sectionsList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked');
  const indices: number[] = [];
  
  checkedBoxes.forEach(checkbox => {
    const index = parseInt(checkbox.dataset.index || '-1', 10);
    if (index >= 0 && index < detectedSections.length) {
      indices.push(index);
    }
  });
  
  return indices;
}

// Update button text based on selection
function updateButtonText() {
  const btnText = extractBtn.querySelector('.btn-text') as HTMLElement;
  const btnIcon = extractBtn.querySelector('.btn-icon') as HTMLElement;
  const selectedCount = getSelectedCount();
  
  if (selectedCount > 1) {
    btnIcon.textContent = '📦';
    btnText.textContent = `Extract ${selectedCount} Pages`;
  } else if (selectedCount === 1) {
    btnIcon.textContent = '📄';
    btnText.textContent = 'Extract 1 Page';
  } else {
    btnIcon.textContent = '📄';
    btnText.textContent = 'Extract This Page';
  }
}

// Smart Extract Button - handles both single page and batch
function setupExtractButton() {
  extractBtn.addEventListener('click', async () => {
    const selectedIndices = getSelectedIndices();
    
    if (selectedIndices.length > 1) {
      // Batch extraction
      await extractMultipleSections(selectedIndices);
    } else if (selectedIndices.length === 1) {
      // Single selected section (might be different from current page)
      await extractSingleSection(selectedIndices[0]);
    } else {
      // No selection - extract current page
      await extractCurrentPage();
    }
  });
}

// Extract current page only
async function extractCurrentPage() {
  try {
    setLoading(true);
    hideStatus();
    
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.id || !tab.url) throw new Error('No active tab');

    currentDomain = extractDomainName(tab.url);

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
    setLoading(false);
  }
}

// Extract single section (possibly different from current page)
async function extractSingleSection(index: number) {
  const section = detectedSections[index];
  
  try {
    setLoading(true);
    hideStatus();
    
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.id) throw new Error('No active tab');

    // Navigate if needed
    if (!section.isCurrentPage) {
      await chrome.tabs.update(tab.id, { url: section.url });
      await waitForPageLoad(tab.id);
    }

    currentDomain = extractDomainName(section.url);

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
    setLoading(false);
  }
}

// Extract multiple sections
async function extractMultipleSections(indices: number[]) {
  try {
    setLoading(true);
    hideStatus();

    const selectedSections = indices.map(i => detectedSections[i]);
    const allContent: ExtractedContent[] = [];
    
    // Set domain from first section
    currentDomain = extractDomainName(selectedSections[0].url);
    
    for (let i = 0; i < selectedSections.length; i++) {
      const section = selectedSections[i];
      
      // Update progress
      showStatus(`Extracting ${i + 1}/${selectedSections.length}...`, 'success');
      
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) continue;

      // Navigate to section URL
      if (!section.isCurrentPage) {
        await chrome.tabs.update(tab.id, { url: section.url });
        await waitForPageLoad(tab.id);
      }

      try {
        const response = await chrome.tabs.sendMessage(tab.id, {
          type: 'EXTRACT_PAGE',
          format: selectedFormat
        });

        if (response.success && response.data) {
          allContent.push(response.data);
        }
      } catch (err) {
        console.error(`Failed to extract ${section.url}:`, err);
      }
    }

    if (allContent.length > 0) {
      await downloadBatchContent(allContent, selectedFormat);
      showStatus(`Extracted ${allContent.length} pages!`, 'success');
    } else {
      showStatus('No content extracted', 'error');
    }
  } catch (error) {
    console.error('Batch extraction error:', error);
    showStatus('Extraction failed', 'error');
  } finally {
    setLoading(false);
  }
}

// Detect documentation sections
async function detectSections() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.id || !tab.url) return;

    currentDomain = extractDomainName(tab.url);

    const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_SECTIONS' });
    
    if (response.success && response.sections && response.sections.length > 0) {
      detectedSections = response.sections;
      renderSections();
      sectionsPanel.classList.remove('hidden');
      updateSelectedCount();
      updateButtonText();
    }
  } catch (error) {
    console.log('No sections detected');
  }
}

// Render sections list
function renderSections() {
  sectionsList.innerHTML = detectedSections.map((section, index) => `
    <div class="section-item ${section.isCurrentPage ? 'current' : ''}" data-index="${index}">
      <input type="checkbox" id="section-${index}" data-index="${index}" ${section.isCurrentPage ? 'checked' : ''}>
      <label for="section-${index}">${escapeHtml(section.title)}</label>
    </div>
  `).join('');
  
  // Make entire row clickable
  sectionsList.querySelectorAll('.section-item').forEach(item => {
    item.addEventListener('click', (e) => {
      // Don't double-toggle if clicking directly on checkbox
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      
      const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
      if (checkbox) {
        checkbox.checked = !checkbox.checked;
        updateSelectAllState();
        updateSelectedCount();
        updateButtonText();
      }
    });
  });
  
  updateSelectAllState();
}

// Wait for page to load properly
function waitForPageLoad(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    const checkComplete = () => {
      chrome.tabs.get(tabId, (tab) => {
        if (tab.status === 'complete') {
          setTimeout(resolve, 800);
        } else {
          setTimeout(checkComplete, 200);
        }
      });
    };
    setTimeout(checkComplete, 500);
  });
}

// Extract a clean domain name for folder organization
function extractDomainName(url: string): string {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    
    let domain = hostname
      .replace(/^www\./, '')
      .replace(/^docs\./, '')
      .replace(/^api\./, '')
      .replace(/^developer\./, '')
      .replace(/^dev\./, '');
    
    const parts = domain.split('.');
    if (parts.length >= 2) {
      domain = parts[0];
    }
    
    return domain
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '')
      .substring(0, 30) || 'extracted';
  } catch {
    return 'extracted';
  }
}

// Download helpers
async function downloadContent(content: ExtractedContent, format: ExportFormat) {
  const filename = sanitizeFilename(content.title);
  const folder = currentDomain || extractDomainName(content.url);

  if (format === 'markdown' || format === 'both') {
    const md = formatAsMarkdown(content);
    await downloadFile(`${folder}/${filename}.md`, md, 'text/markdown');
  }

  if (format === 'json' || format === 'both') {
    const json = JSON.stringify(content, null, 2);
    await downloadFile(`${folder}/${filename}.json`, json, 'application/json');
  }
}

// Download queue to avoid Chrome rate limiting
const downloadQueue: Array<{ filename: string; content: string; mimeType: string }> = [];
let isProcessingQueue = false;

async function downloadBatchContent(contents: ExtractedContent[], format: ExportFormat) {
  const folder = currentDomain || (contents[0] ? extractDomainName(contents[0].url) : 'extracted');

  for (const content of contents) {
    const filename = sanitizeFilename(content.title);
    
    if (format === 'markdown' || format === 'both') {
      const md = formatAsMarkdown(content);
      downloadQueue.push({ filename: `${folder}/${filename}.md`, content: md, mimeType: 'text/markdown' });
    }

    if (format === 'json' || format === 'both') {
      const json = JSON.stringify(content, null, 2);
      downloadQueue.push({ filename: `${folder}/${filename}.json`, content: json, mimeType: 'application/json' });
    }
  }

  await processDownloadQueue();
}

async function processDownloadQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (downloadQueue.length > 0) {
    const item = downloadQueue.shift();
    if (item) {
      await downloadFile(item.filename, item.content, item.mimeType);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  isProcessingQueue = false;
}

function formatAsMarkdown(content: ExtractedContent): string {
  return `# ${content.title}

> **Source:** ${content.url}
> **Extracted:** ${content.extractedAt}

${content.content}`;
}

function downloadFile(filename: string, content: string, mimeType: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    
    chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('Download error:', chrome.runtime.lastError);
        reject(chrome.runtime.lastError);
      } else {
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        resolve();
      }
    });
  });
}

// UI Helpers
function setLoading(loading: boolean) {
  extractBtn.disabled = loading;
  extractBtn.classList.toggle('loading', loading);
}

function showStatus(message: string, type: 'success' | 'error') {
  statusEl.classList.remove('hidden', 'error');
  if (type === 'error') statusEl.classList.add('error');
  
  const icon = statusEl.querySelector('.status-icon') as HTMLElement;
  const text = statusEl.querySelector('.status-text') as HTMLElement;
  
  icon.textContent = type === 'success' ? '✓' : '✕';
  text.textContent = message;
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
