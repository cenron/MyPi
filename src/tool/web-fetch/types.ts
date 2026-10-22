/** What `web_fetch` returns for an HTML page: converted to markdown, or the source as is. */
export type Format = "markdown" | "html";

/** What each format asks the server for first. */
export const ACCEPT: Record<Format, string> = {
  markdown: "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1",
  html: "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, */*;q=0.1",
};

/** HTML types that the markdown format converts. */
export const HTML_TYPES = new Set(["text/html", "application/xhtml+xml"]);

/** What `web_fetch` returns in `details`, for rendering and tests. `title` is set only for a converted page. */
export type FetchedDetails = {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  bytes: number;
  truncated: boolean;
  format: Format;
  converted: boolean;
  title?: string;
  /** Where the whole text was saved when it was cut to fit. */
  fullTextPath?: string;
};
