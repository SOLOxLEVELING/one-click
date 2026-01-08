# Agent Guidelines for Context-Snap

## Project Overview
Context-Snap is a "Zero-UI" Chrome Extension (Manifest V3) that serves as a "Context Feeder" for LLMs.
It extracts high signal-to-noise text from webpages and copies it to the clipboard with a standardized header.

## Core Rules
1.  **Zero-UI**: No popup window. Triggered via **Alt+C** or **Icon Click**.
2.  **No PDF Support**: Explicitly exclude PDF handling. Show "Not supported on PDFs" toast.
3.  **Privacy**: No external calls. All libraries bundled locally.

## Architecture
-   **Manifest V3**: Uses Background Service Worker and Content Scripts.
-   **Extraction**: `@mozilla/readability` -> `turndown` (GFM).
-   **Feedback**: DOM-injected Toast notification ("Context Snapped!").

## Payload Format
Every clipboard entry MUST start with:
```text
[URL: {url}] | [Date: {timestamp}] INSTRUCTION: The following text is provided as raw context for our current session. Please parse this information, acknowledge its receipt, and wait for my specific queries regarding its content.
```

## Commands
-   `npm run dev` - Start HMR dev server.
-   `npm run build` - Build for production.

## Code Style
-   **Imports**: Group imports: external, internal.
-   **Async/Await**: Prefer async/await.
-   **Error Handling**: Fallback to `document.body.innerText` if Readability fails.
-   **Formatting**: Prettier default. 2 spaces.
