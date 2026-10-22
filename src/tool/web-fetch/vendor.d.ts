// Types for the two packages htmlToMarkdown uses that ship none, or none that work here.

/** The GFM plugin for Turndown: tables, strikethrough, and task lists. */
declare module "turndown-plugin-gfm" {
  import type TurndownService from "turndown";
  export const gfm: TurndownService.Plugin;
}

/**
 * domino, the HTML parser Turndown uses in Node. Its own `lib/index.d.ts` declares the old module name, `domino`, and
 * relies on the browser's DOM types, which this project doesn't load. This declares only the parts MyPi calls.
 */
declare module "@mixmark-io/domino" {
  /** A text node, from `Document.createTextNode`. */
  export interface Text {
    readonly nodeName: "#text";
  }

  export interface Element {
    /** The tag name in upper case, such as `MAIN`. */
    readonly nodeName: string;
    /** The element's child elements, without text nodes. */
    readonly children: ArrayLike<Element>;
    /** All the text inside, hidden or not. */
    readonly textContent: string;
    getAttribute(name: string): string | null;
    /** The element itself or its nearest ancestor that matches `selectors`. */
    closest(selectors: string): Element | null;
    querySelector(selectors: string): Element | null;
    querySelectorAll(selectors: string): ArrayLike<Element>;
    appendChild(node: Element | Text): void;
    /** Takes the element, and everything inside it, out of the document. */
    remove(): void;
  }

  export interface Document {
    /** The `<title>` text, untrimmed; `""` when there's none. */
    readonly title: string;
    readonly body: Element;
    querySelectorAll(selectors: string): ArrayLike<Element>;
    createTextNode(text: string): Text;
  }

  const domino: { createDocument(html: string): Document };
  export default domino;
}
