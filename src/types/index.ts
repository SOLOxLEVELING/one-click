// Extraction format options
export type ExportFormat = 'markdown' | 'json' | 'both';

// Extracted content structure
export interface ExtractedContent {
  title: string;
  url: string;
  extractedAt: string;
  content: string;
  headings: Heading[];
  codeBlocks: CodeBlock[];
}

export interface Heading {
  level: number;
  text: string;
  id?: string;
}

export interface CodeBlock {
  language: string;
  code: string;
}

// Section detection for documentation sites
export interface DetectedSection {
  title: string;
  url: string;
  isCurrentPage: boolean;
}

// Message types for popup <-> content script communication
export interface ExtractMessage {
  type: 'EXTRACT_PAGE';
  format: ExportFormat;
}

export interface SectionsMessage {
  type: 'GET_SECTIONS';
}

export interface ExtractResponse {
  success: boolean;
  data?: ExtractedContent;
  error?: string;
}

export interface SectionsResponse {
  success: boolean;
  sections?: DetectedSection[];
  error?: string;
}
