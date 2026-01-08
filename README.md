# One-Click Extract

A Chrome extension that extracts web content in AI-friendly formats with one click.

## Features

- 🎯 **One-Click Extraction** - Extract any webpage's main content instantly
- 📄 **Multiple Formats** - Export as Markdown, JSON, or both
- 📚 **Section Detection** - Automatically detects documentation sections for batch extraction
- 🧹 **Smart Filtering** - Skips nav, footer, ads, and other noise
- 💻 **Code-Aware** - Preserves code blocks with language hints

## Installation

### From Source (Development)

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the extension:
   ```bash
   npm run build
   ```
4. Load in Chrome:
   - Open `chrome://extensions`
   - Enable "Developer mode" (top right)
   - Click "Load unpacked"
   - Select the `dist` folder

## Usage

1. Navigate to any webpage (documentation, articles, etc.)
2. Click the extension icon
3. Choose your format (MD, JSON, or Both)
4. Click "Extract This Page" - file downloads automatically

### Section Extraction (Docs Sites)

On documentation sites, the extension will detect navigation sections:
1. Check/uncheck the sections you want
2. Click "Extract Selected" to batch download

## Output Formats

### Markdown
```markdown
# Page Title

> **Source:** https://example.com/docs/page
> **Extracted:** 2026-01-08

## Content preserved with formatting...
```

### JSON
```json
{
  "title": "Page Title",
  "url": "https://example.com/docs/page",
  "extractedAt": "2026-01-08T19:00:00Z",
  "content": "...",
  "headings": [...],
  "codeBlocks": [...]
}
```

## Development

```bash
# Watch mode (rebuilds on changes)
npm run dev

# Production build
npm run build
```

## Roadmap

- [ ] MCP Integration (Dev Mode for direct AI pipeline)
- [ ] Custom extraction rules per domain
- [ ] Browser sync for settings

## License

MIT
