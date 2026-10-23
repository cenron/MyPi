import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "#tool/web-fetch/markdown";

const BASE = "https://example.com/docs/page";

/** A whole HTML document around `body`. */
const page = (body: string, head = "<title>Page</title>") =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

/** The markdown for a page whose body is `body`. */
const md = (body: string) => htmlToMarkdown(page(body), BASE).markdown;

describe("htmlToMarkdown", () => {
  describe("output style", () => {
    it("fences code blocks with their language", () => {
      expect(md('<pre><code class="language-js">const a = 1;</code></pre>')).toBe("```js\nconst a = 1;\n```");
    });

    it("writes tables as pipe tables", () => {
      const table =
        "<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>";
      const out = md(table);
      expect(out).toContain("| A | B |");
      expect(out).toContain("| --- | --- |");
      expect(out).toContain("| 1 | 2 |");
    });

    it("uses - for bullets", () => {
      expect(md("<ul><li>one</li><li>two</li></ul>")).toMatch(/^-\s+one\n-\s+two$/);
    });
  });

  describe("the root", () => {
    it("converts only <main> when there's exactly one", () => {
      const out = md("<div><p>before</p></div><main><p>inside</p></main><p>after</p>");
      expect(out).toBe("inside");
    });

    it('treats role="main" as <main>', () => {
      expect(md('<p>before</p><div role="main"><p>inside</p></div><p>after</p>')).toBe("inside");
    });

    it("converts the whole body when there are two", () => {
      const out = md("<main><p>first</p></main><main><p>second</p></main><p>after</p>");
      expect(out).toContain("first");
      expect(out).toContain("second");
      expect(out).toContain("after");
    });

    it("converts the whole body when there's none", () => {
      expect(md("<p>one</p><div><p>two</p></div>")).toBe("one\n\ntwo");
    });
  });

  describe("what's removed", () => {
    it("drops scripts, styles, and other non-content elements", () => {
      const noise = [
        '<script>var s = "script text";</script>',
        "<style>.x { color: red }</style>",
        "<noscript>noscript text</noscript>",
        "<template><p>template text</p></template>",
        '<iframe src="https://example.com/frame">iframe text</iframe>',
        "<svg><text>svg text</text></svg>",
        "<canvas>canvas text</canvas>",
        "<form><label>form text</label><input></form>",
      ].join("");
      expect(md(`<p>keep</p>${noise}`)).toBe("keep");
    });

    it("drops nav and aside, even inside <main>", () => {
      expect(md("<main><nav>nav text</nav><p>keep</p><aside>aside text</aside></main>")).toBe("keep");
    });

    it("drops the page's own header and footer", () => {
      expect(md("<header>site header</header><div><p>keep</p></div><footer>site footer</footer>")).toBe("keep");
    });

    // An article's header holds its title, and its footer its byline.
    it("keeps a header and footer inside an article", () => {
      const out = md(
        "<article><header><h1>Article title</h1></header><p>body</p><footer>by someone</footer></article>",
      );
      expect(out).toContain("# Article title");
      expect(out).toContain("by someone");
    });

    it("keeps a header inside <main>", () => {
      expect(md("<header>site</header><main><header><h1>Main title</h1></header><p>x</p></main>")).toBe(
        "# Main title\n\nx",
      );
    });
  });

  describe("hidden elements", () => {
    it("drops elements with the hidden attribute", () => {
      expect(md("<p>shown<span hidden> secret</span></p>")).toBe("shown");
    });

    it('drops aria-hidden="true" but keeps aria-hidden="false"', () => {
      expect(md('<p>a<i aria-hidden="true">icon</i><b aria-hidden="false">b</b></p>')).toBe("a**b**");
    });
  });

  describe("code blocks split into one element per line", () => {
    it("puts each line on its own line", () => {
      const pre =
        '<pre><code class="language-js"><span class="line">const a = 1;</span><span class="line">const b = 2;</span></code></pre>';
      expect(md(pre)).toBe("```js\nconst a = 1;\nconst b = 2;\n```");
    });

    it.each(["code-line", "doc-code-line"])('recognizes class="%s"', (name) => {
      const pre = `<pre><code><span class="${name}">a</span><span class="${name}">b</span></code></pre>`;
      expect(md(pre)).toBe("```\na\nb\n```");
    });

    it("treats div children as lines", () => {
      expect(md("<pre><code><div>a</div><div>b</div></code></pre>")).toBe("```\na\nb\n```");
    });

    it("drops hidden line numbers and keeps the breaks", () => {
      const line = (n: number, text: string) =>
        `<span class="doc-code-line"><span class="doc-line-number" hidden>${n}</span><span>${text}</span></span>`;
      expect(md(`<pre><code>${line(1, "# The Matrix")}${line(2, "")}${line(3, "**Plot:**")}</code></pre>`)).toBe(
        "```\n# The Matrix\n\n**Plot:**\n```",
      );
    });

    it("leaves a one-line block of highlighted tokens on one line", () => {
      const pre =
        '<pre><code><span class="kw">const</span> <span class="id">a</span> = <span class="num">1</span></code></pre>';
      expect(md(pre)).toBe("```\nconst a = 1\n```");
    });

    it("doesn't count a child with no class as a line", () => {
      const pre = '<pre><code><span class="line">a</span><span>b</span></code></pre>';
      expect(md(pre)).toBe("```\nab\n```");
    });

    it("leaves a block that already has newlines alone", () => {
      const pre = '<pre><code><span class="line">a</span>\n<span class="line">b</span></code></pre>';
      expect(md(pre)).toBe("```\na\nb\n```");
    });
  });

  describe("links", () => {
    it("makes a root-relative link absolute", () => {
      expect(md('<p><a href="/other">Other</a></p>')).toBe("[Other](https://example.com/other)");
    });

    it("keeps only the text of a fragment link", () => {
      expect(md('<h2><a href="#syntax">Syntax</a></h2>')).toBe("## Syntax");
      expect(md('<p><a href="#">Top</a></p>')).toBe("Top");
    });

    it("keeps only the text of a javascript: link", () => {
      expect(md('<p><a href="javascript:void(0)">Click</a></p>')).toBe("Click");
    });

    it("leaves a link it can't resolve as written, instead of failing", () => {
      expect(md('<p><a href="http://[oops">Broken</a></p>')).toBe("[Broken](http://[oops)");
    });

    it("keeps only the text of a link with no href", () => {
      expect(md('<p><a name="anchor">Anchor</a></p>')).toBe("Anchor");
    });
  });

  describe("images", () => {
    it("keeps an image with alt text, with an absolute URL", () => {
      expect(md('<p><img src="/logo.png" alt="Logo"></p>')).toBe("![Logo](https://example.com/logo.png)");
    });

    it("drops an image with no alt text", () => {
      expect(md('<p>text<img src="/spacer.gif"></p>')).toBe("text");
      expect(md('<p>text<img src="/icon.png" alt=""></p>')).toBe("text");
    });

    it("drops an image it can't resolve", () => {
      expect(md('<p>text<img src="http://[oops" alt="Broken"></p>')).toBe("text");
    });

    it("drops a data: image, even with alt text", () => {
      expect(md('<p>text<img src="data:image/png;base64,AAAA" alt="Inline"></p>')).toBe("text");
    });
  });

  describe("text", () => {
    it("returns the page's title, trimmed", () => {
      expect(htmlToMarkdown(page("<p>x</p>", "<title>  My Page  </title>"), BASE).title).toBe("My Page");
    });

    it("returns an empty title when there's none", () => {
      expect(htmlToMarkdown(page("<p>x</p>", ""), BASE).title).toBe("");
    });

    it("gives empty markdown for a page with no text", () => {
      expect(md("")).toBe("");
      expect(md("<script>render()</script>")).toBe("");
    });
  });
});
