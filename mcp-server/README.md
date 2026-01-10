# One-Click MCP Server

MCP server for extracting web documentation for AI consumption. Works with Claude Code, Cursor, VSCode, and any MCP-compatible client.

## Installation

```bash
npx one-click-mcp
```

Or install globally:

```bash
npm install -g one-click-mcp
one-click-mcp
```

## Tools

### `extract_documentation`
Extracts documentation content from a URL as clean markdown.

**Arguments:**
- `url` (required): The documentation URL to extract
- `waitTime` (optional): Additional wait time in ms after page load

### `list_documentation_sections`
Detects documentation sections from sidebar/navigation.

**Arguments:**
- `url` (required): Any page on the documentation site

### `extract_multiple_sections`
Batch extract multiple documentation pages.

**Arguments:**
- `urls` (required): Array of URLs to extract

## Configuration

### Claude Desktop
Add to `~/.config/claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "one-click": {
      "command": "npx",
      "args": ["-y", "one-click-mcp"]
    }
  }
}
```

### Cursor
Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "one-click": {
      "command": "npx",
      "args": ["-y", "one-click-mcp"]
    }
  }
}
```

## Development

```bash
npm install
npm run build
npm start
```

## License

MIT
