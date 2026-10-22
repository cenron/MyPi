import domino, { type Element } from "@mixmark-io/domino";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

/** A page converted to markdown: its `<title>`, and the body text. */
export type Converted = { title: string; markdown: string };

/** Elements whose content is never page text. */
const REMOVED_TAGS = ["script", "style", "noscript", "template", "iframe", "svg", "canvas", "form", "nav", "aside"];

/**
 * Converts an HTML page to markdown. Converts only `<main>` when there's exactly one, drops scripts, styles and site
 * chrome, and resolves links and images against `baseUrl`, the page's final URL, so the model can fetch them.
 */
export function htmlToMarkdown(html: string, baseUrl: string): Converted {
  const turndown = createTurndown(baseUrl);
  const document = domino.createDocument(html);
  const mains = document.querySelectorAll("main, [role=main]");
  const root = mains.length === 1 ? mains[0] : document.body;

  return {
    title: document.title,
    markdown: turndown.turndown(root ?? document.body).trim(),
  };
}

const createTurndown = (baseUrl: string): TurndownService => {
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

  // Use the gfm plugin
  turndownService.use(gfm);
  return turndownService;
};

/** `url` resolved against `baseUrl`, or `undefined` when it isn't a valid URL. */
function absolute(url: string, baseUrl: string): string | undefined {
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return undefined;
  }
}
