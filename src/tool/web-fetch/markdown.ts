import domino, { type Document, type Element } from "@mixmark-io/domino";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

/** A page converted to markdown: its `<title>`, and the body text. */
export type Converted = { title: string; markdown: string };

/** Elements whose content is never page text. */
const REMOVED_TAGS = ["script", "style", "noscript", "template", "iframe", "svg", "canvas", "form", "nav", "aside"];

/** Elements a reader never sees: not rendered (`hidden`), or kept from screen readers, as a model should be. */
const HIDDEN = '[hidden], [aria-hidden="true"]';

/** A class naming one line of a code block, as highlighters write it: `line`, `code-line`, `doc-code-line`. */
const LINE_CLASS = /(^|[-_])line$/i;

/**
 * Converts an HTML page to markdown. Converts only `<main>` when there's exactly one, drops scripts, styles and site
 * chrome, and resolves links and images against `baseUrl`, the page's final URL, so the model can fetch them.
 */
export function htmlToMarkdown(html: string, baseUrl: string): Converted {
  const turndown = createTurndown(baseUrl);
  const document = domino.createDocument(html);
  dropHidden(document);
  const mains = document.querySelectorAll("main, [role=main]");
  const root = (mains.length === 1 ? mains[0] : undefined) ?? document.body;
  breakCodeLines(root, document);

  return {
    title: document.title,
    markdown: turndown.turndown(root).trim(),
  };
}

function createTurndown(baseUrl: string): TurndownService {
  const turndownService = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });

  turndownService.remove(REMOVED_TAGS as TurndownService.TagName[]);
  // The site's header and footer are chrome, but an article's own header holds its title, and its footer its byline.
  turndownService.remove(
    (node) =>
      (node.nodeName === "HEADER" || node.nodeName === "FOOTER") &&
      !(node as unknown as Element).closest("article, main"),
  );

  // Absolute URLs, so the model can fetch a link straight from the page. A link that goes nowhere outside the page
  // (a fragment, javascript:, or no href) keeps only its text.
  turndownService.addRule("links", {
    filter: "a",
    replacement: (content, node) => {
      const href = (node as unknown as Element).getAttribute("href")?.trim();
      if (!href || href.startsWith("#") || /^javascript:/i.test(href)) return content;
      return `[${content}](${absolute(href, baseUrl) ?? href})`;
    },
  });

  // An image without alt text is an icon or a spacer, and a data: image is bytes a model can't use.
  turndownService.addRule("images", {
    filter: "img",
    replacement: (_content, node) => {
      const image = node as unknown as Element;
      const alt = image.getAttribute("alt")?.trim();
      const src = image.getAttribute("src")?.trim();
      if (!alt || !src || /^data:/i.test(src)) return "";
      const url = absolute(src, baseUrl);
      return url ? `![${alt}](${url})` : "";
    },
  });

  turndownService.use(gfm);
  return turndownService;
}

/** `url` resolved against `baseUrl`, or `undefined` when it isn't a valid URL. */
function absolute(url: string, baseUrl: string): string | undefined {
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return undefined;
  }
}

/**
 * Takes hidden elements out of the page. This runs on the document, before Turndown, because Turndown reads a code
 * block's text directly: a remove rule wouldn't reach hidden line numbers inside `<pre>`.
 */
function dropHidden(document: Document): void {
  for (const element of Array.from(document.querySelectorAll(HIDDEN))) element.remove();
}

/**
 * Puts a newline after each line of a code block that a highlighter split into one element per line, with the breaks
 * left to CSS. Without it, Turndown joins the lines into one. Only blocks with no newlines of their own, and only
 * children that look like lines (a `div`, or a class such as `line`), so a one-line block of highlighted tokens is
 * left alone.
 */
function breakCodeLines(root: Element, document: Document): void {
  for (const pre of Array.from(root.querySelectorAll("pre"))) {
    if (pre.textContent.includes("\n")) continue;
    const code = pre.querySelector("code") ?? pre;
    const lines = Array.from(code.children).filter(isCodeLine);
    if (lines.length < 2) continue;
    for (const line of lines.slice(0, -1)) line.appendChild(document.createTextNode("\n"));
  }
}

/** True for an element that holds one line of a code block. */
function isCodeLine(element: Element): boolean {
  if (element.nodeName === "DIV") return true;
  const classes = element.getAttribute("class")?.split(/\s+/) ?? [];
  return classes.some((name) => LINE_CLASS.test(name));
}
