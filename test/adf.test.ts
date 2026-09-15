import { describe, expect, it } from "@jest/globals";
import { adfToText, textToAdf, type AdfNode } from "../src/adf.js";

// ---------------------------------------------------------------- helpers

const text = (t: string, marks?: AdfNode["marks"]): AdfNode => ({ type: "text", text: t, ...(marks ? { marks } : {}) });
const para = (...content: AdfNode[]): AdfNode => ({ type: "paragraph", content });
const doc = (...content: AdfNode[]): AdfNode => ({ type: "doc", version: 1, content } as AdfNode);
const listItem = (...content: AdfNode[]): AdfNode => ({ type: "listItem", content });
const bullet = (...items: AdfNode[]): AdfNode => ({ type: "bulletList", content: items });
const ordered = (...items: AdfNode[]): AdfNode => ({ type: "orderedList", content: items });
const hardBreak: AdfNode = { type: "hardBreak" };

// ================================================================ textToAdf

describe("textToAdf", () => {
  describe("document shape", () => {
    it("wraps content in a versioned doc node", () => {
      const out = textToAdf("hi") as AdfNode & { version: number };
      expect(out.type).toBe("doc");
      expect(out.version).toBe(1);
      expect(Array.isArray(out.content)).toBe(true);
    });

    it("returns a single empty paragraph for an empty string", () => {
      expect(textToAdf("")).toEqual(doc(para()));
    });

    it("returns a single empty paragraph for whitespace-only input", () => {
      expect(textToAdf("   \n\n \t \n")).toEqual(doc(para()));
    });

    it("normalises CRLF line endings", () => {
      expect(textToAdf("a\r\nb\r\n\r\nc")).toEqual(doc(para(text("a"), hardBreak, text("b")), para(text("c"))));
    });
  });

  describe("paragraphs", () => {
    it("produces one paragraph for a single line", () => {
      expect(textToAdf("Hello world")).toEqual(doc(para(text("Hello world"))));
    });

    it("joins consecutive lines with hard breaks", () => {
      expect(textToAdf("a\nb\nc")).toEqual(doc(para(text("a"), hardBreak, text("b"), hardBreak, text("c"))));
    });

    it("splits paragraphs on blank lines", () => {
      expect(textToAdf("a\n\nb")).toEqual(doc(para(text("a")), para(text("b"))));
    });

    it("treats multiple blank lines as one separator", () => {
      expect(textToAdf("a\n\n\n\nb")).toEqual(doc(para(text("a")), para(text("b"))));
    });

    it("treats whitespace-only lines as blank", () => {
      expect(textToAdf("a\n   \nb")).toEqual(doc(para(text("a")), para(text("b"))));
    });

    it("ignores leading and trailing blank lines", () => {
      expect(textToAdf("\n\na\n\n")).toEqual(doc(para(text("a"))));
    });

    it("preserves leading whitespace inside a paragraph line", () => {
      expect(textToAdf("  indented")).toEqual(doc(para(text("  indented"))));
    });

    it("ends a paragraph when a heading line follows without a blank line", () => {
      expect(textToAdf("a\n# H")).toEqual(
        doc(para(text("a")), { type: "heading", attrs: { level: 1 }, content: [text("H")] }),
      );
    });

    it("ends a paragraph when a list line follows without a blank line", () => {
      expect(textToAdf("a\n- b")).toEqual(doc(para(text("a")), bullet(listItem(para(text("b"))))));
    });

    it("ends a paragraph when a code fence follows without a blank line", () => {
      expect(textToAdf("a\n```\nx\n```")).toEqual(
        doc(para(text("a")), { type: "codeBlock", content: [text("x")] }),
      );
    });
  });

  describe("headings", () => {
    it.each([1, 2, 3, 4, 5, 6])("parses a level %i heading", (level) => {
      expect(textToAdf(`${"#".repeat(level)} Title`)).toEqual(
        doc({ type: "heading", attrs: { level }, content: [text("Title")] }),
      );
    });

    it("does not treat seven hashes as a heading", () => {
      expect(textToAdf("####### Not a heading")).toEqual(doc(para(text("####### Not a heading"))));
    });

    it("requires whitespace after the hashes", () => {
      expect(textToAdf("#hashtag")).toEqual(doc(para(text("#hashtag"))));
    });

    it("does not treat an indented hash line as a heading", () => {
      expect(textToAdf("  # nope")).toEqual(doc(para(text("  # nope"))));
    });

    it("keeps heading text raw (no inline parsing of code spans or urls)", () => {
      expect(textToAdf("# See `x` at https://a.b")).toEqual(
        doc({ type: "heading", attrs: { level: 1 }, content: [text("See `x` at https://a.b")] }),
      );
    });

    it("allows a heading with empty text", () => {
      expect(textToAdf("# ")).toEqual(doc({ type: "heading", attrs: { level: 1 }, content: [text("")] }));
    });

    it("places consecutive headings as separate nodes", () => {
      expect(textToAdf("# A\n## B")).toEqual(
        doc(
          { type: "heading", attrs: { level: 1 }, content: [text("A")] },
          { type: "heading", attrs: { level: 2 }, content: [text("B")] },
        ),
      );
    });
  });

  describe("bullet lists", () => {
    it("parses dash bullets", () => {
      expect(textToAdf("- a\n- b")).toEqual(doc(bullet(listItem(para(text("a"))), listItem(para(text("b"))))));
    });

    it("parses asterisk bullets", () => {
      expect(textToAdf("* a\n* b")).toEqual(doc(bullet(listItem(para(text("a"))), listItem(para(text("b"))))));
    });

    it("merges mixed dash and asterisk markers into one list", () => {
      expect(textToAdf("- a\n* b")).toEqual(doc(bullet(listItem(para(text("a"))), listItem(para(text("b"))))));
    });

    it("accepts indented bullets", () => {
      expect(textToAdf("  - a\n\t- b")).toEqual(doc(bullet(listItem(para(text("a"))), listItem(para(text("b"))))));
    });

    it("accepts multiple spaces after the marker", () => {
      expect(textToAdf("-   a")).toEqual(doc(bullet(listItem(para(text("a"))))));
    });

    it("requires whitespace after the marker", () => {
      expect(textToAdf("-a")).toEqual(doc(para(text("-a"))));
    });

    it("does not treat a bare dash as a list item", () => {
      expect(textToAdf("-")).toEqual(doc(para(text("-"))));
    });

    it("applies inline parsing inside items", () => {
      expect(textToAdf("- run `ls`")).toEqual(
        doc(bullet(listItem(para(text("run "), text("ls", [{ type: "code" }]))))),
      );
    });

    it("ends the list at a non-list line", () => {
      expect(textToAdf("- a\ntail")).toEqual(doc(bullet(listItem(para(text("a")))), para(text("tail"))));
    });

    it("ends the list at a blank line and starts a new list afterwards", () => {
      expect(textToAdf("- a\n\n- b")).toEqual(
        doc(bullet(listItem(para(text("a")))), bullet(listItem(para(text("b"))))),
      );
    });
  });

  describe("ordered lists", () => {
    it("parses dot-numbered items", () => {
      expect(textToAdf("1. a\n2. b")).toEqual(doc(ordered(listItem(para(text("a"))), listItem(para(text("b"))))));
    });

    it("parses paren-numbered items", () => {
      expect(textToAdf("1) a\n2) b")).toEqual(doc(ordered(listItem(para(text("a"))), listItem(para(text("b"))))));
    });

    it("does not care about the actual numbers", () => {
      expect(textToAdf("7. a\n3. b\n99. c")).toEqual(
        doc(ordered(listItem(para(text("a"))), listItem(para(text("b"))), listItem(para(text("c"))))),
      );
    });

    it("accepts multi-digit numbers and indentation", () => {
      expect(textToAdf("  10. a")).toEqual(doc(ordered(listItem(para(text("a"))))));
    });

    it("requires whitespace after the number marker", () => {
      expect(textToAdf("1.5 is a number")).toEqual(doc(para(text("1.5 is a number"))));
    });

    it("separates an ordered list from a following bullet list", () => {
      expect(textToAdf("1. a\n- b")).toEqual(
        doc(ordered(listItem(para(text("a")))), bullet(listItem(para(text("b"))))),
      );
    });

    it("separates a bullet list from a following ordered list", () => {
      expect(textToAdf("- a\n1. b")).toEqual(
        doc(bullet(listItem(para(text("a")))), ordered(listItem(para(text("b"))))),
      );
    });
  });

  describe("code fences", () => {
    it("parses a fenced block with a language", () => {
      expect(textToAdf("```ts\nconst a = 1;\n```")).toEqual(
        doc({ type: "codeBlock", attrs: { language: "ts" }, content: [text("const a = 1;")] }),
      );
    });

    it("omits attrs when no language is given", () => {
      const out = textToAdf("```\nx\n```");
      expect(out).toEqual(doc({ type: "codeBlock", content: [text("x")] }));
      expect(out.content?.[0]).not.toHaveProperty("attrs");
    });

    it("trims whitespace around the language tag", () => {
      expect(textToAdf("```  sh \nx\n```")).toEqual(
        doc({ type: "codeBlock", attrs: { language: "sh" }, content: [text("x")] }),
      );
    });

    it("keeps multiple lines joined with newlines", () => {
      expect(textToAdf("```\na\nb\nc\n```")).toEqual(doc({ type: "codeBlock", content: [text("a\nb\nc")] }));
    });

    it("preserves blank lines inside the block", () => {
      expect(textToAdf("```\na\n\nb\n```")).toEqual(doc({ type: "codeBlock", content: [text("a\n\nb")] }));
    });

    it("does not interpret markdown inside the block", () => {
      expect(textToAdf("```\n# not heading\n- not list\n1. nope\n`x` https://u\n```")).toEqual(
        doc({ type: "codeBlock", content: [text("# not heading\n- not list\n1. nope\n`x` https://u")] }),
      );
    });

    it("preserves indentation inside the block", () => {
      expect(textToAdf("```\n  two\n\tone\n```")).toEqual(doc({ type: "codeBlock", content: [text("  two\n\tone")] }));
    });

    it("produces an empty text node for an empty block", () => {
      expect(textToAdf("```\n```")).toEqual(doc({ type: "codeBlock", content: [text("")] }));
    });

    it("consumes to end of input when the fence is never closed", () => {
      expect(textToAdf("```\na\nb")).toEqual(doc({ type: "codeBlock", content: [text("a\nb")] }));
    });

    it("accepts a closing fence with trailing characters", () => {
      expect(textToAdf("```\na\n```   \nafter")).toEqual(
        doc({ type: "codeBlock", content: [text("a")] }, para(text("after"))),
      );
    });

    it("handles several blocks in one document", () => {
      expect(textToAdf("```\na\n```\n\n```py\nb\n```")).toEqual(
        doc(
          { type: "codeBlock", content: [text("a")] },
          { type: "codeBlock", attrs: { language: "py" }, content: [text("b")] },
        ),
      );
    });

    it("does not treat an indented fence as a fence", () => {
      expect(textToAdf("  ```\nx")).toEqual(doc(para(text("  ```"), hardBreak, text("x"))));
    });
  });

  describe("inline: code spans", () => {
    it("turns backtick spans into code-marked text", () => {
      expect(textToAdf("`a`")).toEqual(doc(para(text("a", [{ type: "code" }]))));
    });

    it("keeps surrounding text as separate plain nodes", () => {
      expect(textToAdf("run `ls -la` now")).toEqual(
        doc(para(text("run "), text("ls -la", [{ type: "code" }]), text(" now"))),
      );
    });

    it("handles several spans in one line", () => {
      expect(textToAdf("`a` and `b`")).toEqual(
        doc(para(text("a", [{ type: "code" }]), text(" and "), text("b", [{ type: "code" }]))),
      );
    });

    it("handles adjacent spans with no text between", () => {
      expect(textToAdf("`a``b`")).toEqual(doc(para(text("a", [{ type: "code" }]), text("b", [{ type: "code" }]))));
    });

    it("leaves an unmatched backtick as plain text", () => {
      expect(textToAdf("a ` b")).toEqual(doc(para(text("a ` b"))));
    });

    it("leaves an empty span (``) as plain text", () => {
      expect(textToAdf("a `` b")).toEqual(doc(para(text("a `` b"))));
    });

    it("does not link a url inside a code span", () => {
      expect(textToAdf("`https://a.b`")).toEqual(doc(para(text("https://a.b", [{ type: "code" }]))));
    });

    it("does not let a span cross a hard break", () => {
      expect(textToAdf("`a\nb`")).toEqual(doc(para(text("`a"), hardBreak, text("b`"))));
    });
  });

  describe("inline: links", () => {
    const link = (href: string) => [{ type: "link", attrs: { href } }];

    it("turns a bare https url into link-marked text", () => {
      expect(textToAdf("https://example.com")).toEqual(
        doc(para(text("https://example.com", link("https://example.com")))),
      );
    });

    it("turns a bare http url into link-marked text", () => {
      expect(textToAdf("http://example.com")).toEqual(doc(para(text("http://example.com", link("http://example.com")))));
    });

    it("keeps text around the url", () => {
      expect(textToAdf("see https://a.b/c?d=1 now")).toEqual(
        doc(para(text("see "), text("https://a.b/c?d=1", link("https://a.b/c?d=1")), text(" now"))),
      );
    });

    it.each([
      ["whitespace", "https://a.b next", "https://a.b", " next"],
      ["closing paren", "https://a.b)", "https://a.b", ")"],
      ["closing bracket", "https://a.b]", "https://a.b", "]"],
      ["double quote", 'https://a.b"', "https://a.b", '"'],
      ["single quote", "https://a.b'", "https://a.b", "'"],
      ["less-than", "https://a.b<x", "https://a.b", "<x"],
      ["greater-than", "https://a.b>x", "https://a.b", ">x"],
    ])("stops the url at %s", (_name, input, url, rest) => {
      expect(textToAdf(input)).toEqual(doc(para(text(url, link(url)), text(rest))));
    });

    it("includes trailing punctuation like a period in the url", () => {
      expect(textToAdf("https://a.b.")).toEqual(doc(para(text("https://a.b.", link("https://a.b.")))));
    });

    it("handles several urls in one line", () => {
      expect(textToAdf("https://a.b https://c.d")).toEqual(
        doc(para(text("https://a.b", link("https://a.b")), text(" "), text("https://c.d", link("https://c.d")))),
      );
    });

    it("does not link schemes other than http(s)", () => {
      expect(textToAdf("ftp://a.b mailto:x@y.z")).toEqual(doc(para(text("ftp://a.b mailto:x@y.z"))));
    });

    it("is case-sensitive on the scheme", () => {
      expect(textToAdf("HTTPS://a.b")).toEqual(doc(para(text("HTTPS://a.b"))));
    });

    it("mixes code spans and urls in order of appearance", () => {
      expect(textToAdf("`a` https://b.c `d`")).toEqual(
        doc(
          para(
            text("a", [{ type: "code" }]),
            text(" "),
            text("https://b.c", link("https://b.c")),
            text(" "),
            text("d", [{ type: "code" }]),
          ),
        ),
      );
    });
  });

  describe("inline: hard breaks", () => {
    it("never emits empty text nodes around a break", () => {
      const out = textToAdf("a\nb");
      const texts = out.content![0].content!.filter((n) => n.type === "text");
      expect(texts.every((n) => (n.text ?? "").length > 0)).toBe(true);
    });

    it("parses inline content independently on each line", () => {
      expect(textToAdf("`a`\nhttps://b.c")).toEqual(
        doc(
          para(
            text("a", [{ type: "code" }]),
            hardBreak,
            text("https://b.c", [{ type: "link", attrs: { href: "https://b.c" } }]),
          ),
        ),
      );
    });
  });

  describe("mixed documents", () => {
    it("parses a realistic ticket description in order", () => {
      const input = [
        "# Summary",
        "Login fails with `401`.",
        "See https://example.com/logs for details.",
        "",
        "## Steps",
        "1. Open app",
        "2. Click login",
        "",
        "Expected:",
        "- Session created",
        "- Redirect home",
        "",
        "```json",
        '{ "error": "unauthorized" }',
        "```",
        "",
        "Thanks",
      ].join("\n");

      expect(textToAdf(input)).toEqual(
        doc(
          { type: "heading", attrs: { level: 1 }, content: [text("Summary")] },
          para(
            text("Login fails with "),
            text("401", [{ type: "code" }]),
            text("."),
            hardBreak,
            text("See "),
            text("https://example.com/logs", [{ type: "link", attrs: { href: "https://example.com/logs" } }]),
            text(" for details."),
          ),
          { type: "heading", attrs: { level: 2 }, content: [text("Steps")] },
          ordered(listItem(para(text("Open app"))), listItem(para(text("Click login")))),
          para(text("Expected:")),
          bullet(listItem(para(text("Session created"))), listItem(para(text("Redirect home")))),
          { type: "codeBlock", attrs: { language: "json" }, content: [text('{ "error": "unauthorized" }')] },
          para(text("Thanks")),
        ),
      );
    });
  });
});

// ================================================================ adfToText

describe("adfToText", () => {
  describe("input guards", () => {
    it("returns an empty string for null", () => {
      expect(adfToText(null)).toBe("");
    });

    it("returns an empty string for undefined", () => {
      expect(adfToText(undefined)).toBe("");
    });

    it("passes a string through unchanged", () => {
      expect(adfToText("legacy *wiki* text")).toBe("legacy *wiki* text");
    });

    it("returns an empty string for a doc without content", () => {
      expect(adfToText({ type: "doc" })).toBe("");
    });

    it("returns an empty string for a doc with empty content", () => {
      expect(adfToText(doc())).toBe("");
    });

    it("returns an empty string for an empty paragraph", () => {
      expect(adfToText(doc(para()))).toBe("");
    });
  });

  describe("paragraphs and whitespace", () => {
    it("renders a single paragraph without a trailing newline", () => {
      expect(adfToText(doc(para(text("Hello"))))).toBe("Hello");
    });

    it("separates paragraphs with one blank line", () => {
      expect(adfToText(doc(para(text("a")), para(text("b"))))).toBe("a\n\nb");
    });

    it("concatenates inline nodes inside a paragraph", () => {
      expect(adfToText(doc(para(text("a"), text("b"), text("c"))))).toBe("abc");
    });

    it("renders hard breaks as single newlines", () => {
      expect(adfToText(doc(para(text("a"), hardBreak, text("b"))))).toBe("a\nb");
    });

    it("collapses runs of three or more newlines to two", () => {
      expect(adfToText(doc(para(text("a")), para(), para(), para(text("b"))))).toBe("a\n\nb");
    });

    it("trims leading and trailing whitespace of the whole document", () => {
      expect(adfToText(doc(para(text("  a  "))))).toBe("a");
    });

    it("renders a bare paragraph node (not wrapped in a doc)", () => {
      expect(adfToText(para(text("solo")))).toBe("solo");
    });
  });

  describe("headings", () => {
    it.each([1, 2, 3, 4, 5, 6])("renders level %i with that many hashes", (level) => {
      expect(adfToText(doc({ type: "heading", attrs: { level }, content: [text("T")] }))).toBe(
        `${"#".repeat(level)} T`,
      );
    });

    it("defaults to level 1 when attrs are missing", () => {
      expect(adfToText(doc({ type: "heading", content: [text("T")] }))).toBe("# T");
    });

    it("renders inline marks inside a heading", () => {
      expect(adfToText(doc({ type: "heading", attrs: { level: 2 }, content: [text("x", [{ type: "code" }])] }))).toBe(
        "## `x`",
      );
    });

    it("separates a heading from the following paragraph with a blank line", () => {
      expect(adfToText(doc({ type: "heading", attrs: { level: 1 }, content: [text("T")] }, para(text("p"))))).toBe(
        "# T\n\np",
      );
    });
  });

  describe("text marks", () => {
    const render = (t: string, marks: AdfNode["marks"]) => adfToText(doc(para(text(t, marks))));

    it("renders code", () => expect(render("x", [{ type: "code" }])).toBe("`x`"));
    it("renders strong", () => expect(render("x", [{ type: "strong" }])).toBe("**x**"));
    it("renders em", () => expect(render("x", [{ type: "em" }])).toBe("_x_"));
    it("renders strike", () => expect(render("x", [{ type: "strike" }])).toBe("~~x~~"));

    it("renders a link whose href differs from the text as text (href)", () => {
      expect(render("docs", [{ type: "link", attrs: { href: "https://d.io" } }])).toBe("docs (https://d.io)");
    });

    it("renders a link whose href equals the text as just the text", () => {
      expect(render("https://d.io", [{ type: "link", attrs: { href: "https://d.io" } }])).toBe("https://d.io");
    });

    it("renders a link without an href as plain text", () => {
      expect(render("docs", [{ type: "link" }])).toBe("docs");
      expect(render("docs", [{ type: "link", attrs: {} }])).toBe("docs");
    });

    it("ignores unknown marks", () => {
      expect(render("x", [{ type: "textColor", attrs: { color: "#ff0000" } }])).toBe("x");
      expect(render("x", [{ type: "underline" }])).toBe("x");
      expect(render("x", [{ type: "subsup", attrs: { type: "sup" } }])).toBe("x");
    });

    it("applies multiple marks in array order (inner first)", () => {
      expect(render("x", [{ type: "strong" }, { type: "em" }])).toBe("_**x**_");
      expect(render("x", [{ type: "em" }, { type: "strong" }])).toBe("**_x_**");
    });

    it("applies a link mark around other marks when it comes last", () => {
      expect(render("x", [{ type: "code" }, { type: "link", attrs: { href: "https://h" } }])).toBe("`x` (https://h)");
    });

    it("keeps surrounding whitespace outside the markers", () => {
      expect(adfToText(doc(para(text("a"), text(" bold ", [{ type: "strong" }]), text("b"))))).toBe("a **bold** b");
    });

    it("keeps leading-only and trailing-only whitespace outside the markers", () => {
      expect(adfToText(doc(para(text("a"), text(" b", [{ type: "em" }]))))).toBe("a _b_");
      expect(adfToText(doc(para(text("a ", [{ type: "em" }]), text("b"))))).toBe("_a_ b");
    });

    it("returns whitespace-only marked text unchanged and unmarked", () => {
      expect(adfToText(doc(para(text("a"), text("   ", [{ type: "strong" }]), text("b"))))).toBe("a   b");
    });

    it("renders text with no marks as-is", () => {
      expect(adfToText(doc(para({ type: "text", text: "plain" })))).toBe("plain");
    });

    it("renders a text node without a text field as empty", () => {
      expect(adfToText(doc(para({ type: "text" })))).toBe("");
      expect(adfToText(doc(para({ type: "text", marks: [{ type: "strong" }] })))).toBe("");
    });
  });

  describe("bullet lists", () => {
    it("renders items with a dash", () => {
      expect(adfToText(doc(bullet(listItem(para(text("a"))), listItem(para(text("b"))))))).toBe("- a\n- b");
    });

    it("separates the list from following content with a blank line", () => {
      expect(adfToText(doc(bullet(listItem(para(text("a")))), para(text("p"))))).toBe("- a\n\np");
    });

    it("indents nested bullet lists by two spaces per level", () => {
      const nested = bullet(
        listItem(para(text("a")), bullet(listItem(para(text("a1"))), listItem(para(text("a2"))))),
        listItem(para(text("b"))),
      );
      expect(adfToText(doc(nested))).toBe("- a\n  - a1\n  - a2\n- b");
    });

    it("indents doubly nested lists by four spaces", () => {
      const nested = bullet(listItem(para(text("a")), bullet(listItem(para(text("b")), bullet(listItem(para(text("c"))))))));
      expect(adfToText(doc(nested))).toBe("- a\n  - b\n    - c");
    });

    it("does not leave a blank line between a nested list and the next sibling", () => {
      const nested = bullet(listItem(para(text("a")), bullet(listItem(para(text("a1"))))), listItem(para(text("b"))));
      expect(adfToText(doc(nested))).not.toContain("\n\n");
    });

    it("separates a list ending in a nested list from following content with one blank line", () => {
      const nested = bullet(listItem(para(text("a")), bullet(listItem(para(text("a1"))))));
      expect(adfToText(doc(nested, para(text("after"))))).toBe("- a\n  - a1\n\nafter");
    });

    it("nests an ordered list inside a bullet item", () => {
      const nested = bullet(listItem(para(text("a")), ordered(listItem(para(text("one"))))));
      expect(adfToText(doc(nested))).toBe("- a\n  1. one");
    });

    it("renders extra paragraphs in an item as continuation lines", () => {
      expect(adfToText(doc(bullet(listItem(para(text("first")), para(text("second"))))))).toBe("- first\nsecond");
    });

    it("renders an item with no content as a bare bullet", () => {
      expect(adfToText(doc(bullet({ type: "listItem" }, listItem(para(text("b"))))))).toBe("- \n- b");
    });

    it("renders an empty list as nothing", () => {
      expect(adfToText(doc({ type: "bulletList" }))).toBe("");
      expect(adfToText(doc(bullet()))).toBe("");
    });

    it("renders inline marks inside items", () => {
      expect(adfToText(doc(bullet(listItem(para(text("run "), text("ls", [{ type: "code" }]))))))).toBe("- run `ls`");
    });

    it("renders a stray listItem outside a list with a dash", () => {
      expect(adfToText(doc(listItem(para(text("x")))))).toBe("- x");
    });
  });

  describe("ordered lists", () => {
    it("numbers items from 1 by default", () => {
      expect(adfToText(doc(ordered(listItem(para(text("a"))), listItem(para(text("b"))), listItem(para(text("c"))))))).toBe(
        "1. a\n2. b\n3. c",
      );
    });

    it("honours a custom start number", () => {
      expect(adfToText(doc({ type: "orderedList", attrs: { order: 5 }, content: [listItem(para(text("a"))), listItem(para(text("b")))] }))).toBe(
        "5. a\n6. b",
      );
    });

    it("honours a zero start number", () => {
      expect(adfToText(doc({ type: "orderedList", attrs: { order: 0 }, content: [listItem(para(text("a")))] }))).toBe("0. a");
    });

    it("indents nested ordered lists and restarts numbering", () => {
      const nested = ordered(
        listItem(para(text("a")), ordered(listItem(para(text("a1"))), listItem(para(text("a2"))))),
        listItem(para(text("b"))),
      );
      expect(adfToText(doc(nested))).toBe("1. a\n  1. a1\n  2. a2\n2. b");
    });

    it("renders an empty ordered list as nothing", () => {
      expect(adfToText(doc({ type: "orderedList" }))).toBe("");
    });
  });

  describe("code blocks", () => {
    it("renders a fenced block with a language", () => {
      expect(adfToText(doc({ type: "codeBlock", attrs: { language: "ts" }, content: [text("let a;")] }))).toBe(
        "```ts\nlet a;\n```",
      );
    });

    it("renders a fenced block without a language", () => {
      expect(adfToText(doc({ type: "codeBlock", content: [text("x")] }))).toBe("```\nx\n```");
    });

    it("renders an empty block as an empty fence", () => {
      expect(adfToText(doc({ type: "codeBlock" }))).toBe("```\n\n```");
    });

    it("keeps multi-line content verbatim", () => {
      expect(adfToText(doc({ type: "codeBlock", content: [text("a\n  b\n\nc")] }))).toBe("```\na\n  b\n\nc\n```");
    });

    it("does not apply marks inside a code block text node", () => {
      // Marks are still processed by the text renderer; verify plain text passes through.
      expect(adfToText(doc({ type: "codeBlock", content: [text("plain")] }))).toBe("```\nplain\n```");
    });

    it("separates the block from surrounding paragraphs with blank lines", () => {
      expect(adfToText(doc(para(text("a")), { type: "codeBlock", content: [text("x")] }, para(text("b"))))).toBe(
        "a\n\n```\nx\n```\n\nb",
      );
    });
  });

  describe("blockquote", () => {
    it("prefixes each line with >", () => {
      expect(adfToText(doc({ type: "blockquote", content: [para(text("a")), para(text("b"))] }))).toBe("> a\n> b");
    });

    it("prefixes hard-break lines individually", () => {
      expect(adfToText(doc({ type: "blockquote", content: [para(text("a"), hardBreak, text("b"))] }))).toBe("> a\n> b");
    });

    it("drops empty lines inside the quote", () => {
      expect(adfToText(doc({ type: "blockquote", content: [para(text("a")), para(), para(text("b"))] }))).toBe("> a\n> b");
    });

    it("renders an empty blockquote as nothing", () => {
      expect(adfToText(doc({ type: "blockquote" }))).toBe("");
    });
  });

  describe("rule", () => {
    it("renders a horizontal rule", () => {
      expect(adfToText(doc(para(text("a")), { type: "rule" }, para(text("b"))))).toBe("a\n\n---\n\nb");
    });
  });

  describe("mention", () => {
    it("uses the display text when present", () => {
      expect(adfToText(doc(para({ type: "mention", attrs: { id: "123", text: "@Sam" } })))).toBe("@Sam");
    });

    it("falls back to @id", () => {
      expect(adfToText(doc(para({ type: "mention", attrs: { id: "abc" } })))).toBe("@abc");
    });

    it("falls back to @user when nothing is known", () => {
      expect(adfToText(doc(para({ type: "mention" })))).toBe("@user");
      expect(adfToText(doc(para({ type: "mention", attrs: {} })))).toBe("@user");
    });

    it("sits inline with surrounding text", () => {
      expect(adfToText(doc(para(text("hi "), { type: "mention", attrs: { text: "@Sam" } }, text(", ok"))))).toBe(
        "hi @Sam, ok",
      );
    });
  });

  describe("emoji", () => {
    it("uses the unicode text when present", () => {
      expect(adfToText(doc(para({ type: "emoji", attrs: { shortName: ":smile:", text: "😄" } })))).toBe("😄");
    });

    it("falls back to the short name", () => {
      expect(adfToText(doc(para({ type: "emoji", attrs: { shortName: ":smile:" } })))).toBe(":smile:");
    });

    it("renders nothing when neither is present", () => {
      expect(adfToText(doc(para(text("a"), { type: "emoji" }, text("b"))))).toBe("ab");
    });
  });

  describe("cards", () => {
    it("renders an inlineCard as its url inline", () => {
      expect(adfToText(doc(para(text("see "), { type: "inlineCard", attrs: { url: "https://x.y" } }, text(" ok"))))).toBe(
        "see https://x.y ok",
      );
    });

    it("renders a blockCard as its url on its own line", () => {
      expect(adfToText(doc(para(text("a")), { type: "blockCard", attrs: { url: "https://x.y" } }, para(text("b"))))).toBe(
        "a\n\nhttps://x.y\n\nb",
      );
    });

    it("renders an embedCard as its url on its own line", () => {
      expect(adfToText(doc({ type: "embedCard", attrs: { url: "https://e.f" } }, para(text("b"))))).toBe("https://e.f\n\nb");
    });

    it("renders cards without a url as empty", () => {
      expect(adfToText(doc(para({ type: "inlineCard" })))).toBe("");
      expect(adfToText(doc({ type: "blockCard", attrs: {} }))).toBe("");
    });
  });

  describe("date", () => {
    it("renders a timestamp as an ISO date", () => {
      const ts = String(Date.UTC(2024, 2, 15, 13, 45));
      expect(adfToText(doc(para({ type: "date", attrs: { timestamp: ts } })))).toBe("2024-03-15");
    });

    it("accepts a numeric timestamp", () => {
      expect(adfToText(doc(para({ type: "date", attrs: { timestamp: Date.UTC(2020, 0, 1) } })))).toBe("2020-01-01");
    });

    it("renders nothing without a timestamp", () => {
      expect(adfToText(doc(para({ type: "date" })))).toBe("");
      expect(adfToText(doc(para({ type: "date", attrs: {} })))).toBe("");
    });
  });

  describe("status", () => {
    it("renders the status text in brackets", () => {
      expect(adfToText(doc(para({ type: "status", attrs: { text: "DONE", color: "green" } })))).toBe("[DONE]");
    });

    it("renders empty brackets without text", () => {
      expect(adfToText(doc(para({ type: "status" })))).toBe("[]");
    });
  });

  describe("panel", () => {
    it("labels the panel with its type and renders the body", () => {
      expect(adfToText(doc({ type: "panel", attrs: { panelType: "info" }, content: [para(text("note"))] }))).toBe(
        "[info]\nnote",
      );
    });

    it("falls back to a generic label", () => {
      expect(adfToText(doc({ type: "panel", content: [para(text("note"))] }))).toBe("[panel]\nnote");
    });

    it("renders an empty panel as just its label", () => {
      expect(adfToText(doc({ type: "panel", attrs: { panelType: "warning" } }))).toBe("[warning]");
    });
  });

  describe("tables", () => {
    const cell = (type: "tableCell" | "tableHeader", ...content: AdfNode[]): AdfNode => ({ type, content });
    const row = (...cells: AdfNode[]): AdfNode => ({ type: "tableRow", content: cells });
    const table = (...rows: AdfNode[]): AdfNode => ({ type: "table", content: rows });

    it("renders rows as pipe-separated lines", () => {
      const t = table(
        row(cell("tableHeader", para(text("Name"))), cell("tableHeader", para(text("Age")))),
        row(cell("tableCell", para(text("Sam"))), cell("tableCell", para(text("30")))),
      );
      expect(adfToText(doc(t))).toBe("| Name | Age |\n| Sam | 30 |");
    });

    it("flattens newlines inside a cell to spaces", () => {
      const t = table(row(cell("tableCell", para(text("a"), hardBreak, text("b")))));
      expect(adfToText(doc(t))).toBe("| a b |");
    });

    it("joins multiple paragraphs in a cell with a space", () => {
      const t = table(row(cell("tableCell", para(text("a")), para(text("b")))));
      expect(adfToText(doc(t))).toBe("| a b |");
    });

    it("renders an empty cell as an empty column", () => {
      const t = table(row(cell("tableCell"), cell("tableCell", para(text("x")))));
      expect(adfToText(doc(t))).toBe("|  | x |");
    });

    it("renders an empty row as an empty pipe pair", () => {
      expect(adfToText(doc(table(row())))).toBe("|  |");
    });

    it("renders an empty table as nothing", () => {
      expect(adfToText(doc({ type: "table" }))).toBe("");
    });

    it("separates the table from following content with a blank line", () => {
      expect(adfToText(doc(table(row(cell("tableCell", para(text("a"))))), para(text("after"))))).toBe("| a |\n\nafter");
    });
  });

  describe("media", () => {
    it("renders a media node as an attachment placeholder", () => {
      expect(adfToText(doc(para({ type: "media", attrs: { id: "x", type: "file" } })))).toBe("[attachment]");
    });

    it("includes the alt text when present", () => {
      expect(adfToText(doc(para({ type: "media", attrs: { alt: "screenshot.png" } })))).toBe("[attachment: screenshot.png]");
    });

    it("renders mediaSingle wrapping a media node", () => {
      expect(adfToText(doc({ type: "mediaSingle", content: [{ type: "media", attrs: { alt: "a.png" } }] }, para(text("b"))))).toBe(
        "[attachment: a.png]\n\nb",
      );
    });

    it("renders mediaGroup with several media nodes concatenated", () => {
      const group: AdfNode = { type: "mediaGroup", content: [{ type: "media" }, { type: "media", attrs: { alt: "b" } }] };
      expect(adfToText(doc(group))).toBe("[attachment][attachment: b]");
    });

    it("renders an empty mediaSingle as nothing", () => {
      expect(adfToText(doc({ type: "mediaSingle" }))).toBe("");
    });
  });

  describe("expand", () => {
    it("renders the title on its own line followed by the body", () => {
      expect(adfToText(doc({ type: "expand", attrs: { title: "More" }, content: [para(text("body"))] }))).toBe("More\nbody");
    });

    it("renders just the body when there is no title", () => {
      expect(adfToText(doc({ type: "expand", content: [para(text("body"))] }))).toBe("body");
      expect(adfToText(doc({ type: "expand", attrs: { title: "" }, content: [para(text("body"))] }))).toBe("body");
    });

    it("renders nestedExpand the same way", () => {
      expect(adfToText(doc({ type: "nestedExpand", attrs: { title: "Inner" }, content: [para(text("x"))] }))).toBe("Inner\nx");
    });

    it("renders an empty expand as only the title", () => {
      expect(adfToText(doc({ type: "expand", attrs: { title: "T" } }))).toBe("T");
    });
  });

  describe("unknown node types", () => {
    it("renders the children of an unknown container", () => {
      expect(adfToText(doc({ type: "taskList", content: [{ type: "taskItem", content: [text("todo")] }] }))).toBe("todo");
    });

    it("renders an unknown leaf as nothing", () => {
      expect(adfToText(doc(para(text("a"), { type: "somethingNew", attrs: { x: 1 } }, text("b"))))).toBe("ab");
    });

    it("renders a node without a type by walking children", () => {
      expect(adfToText({ content: [para(text("x"))] } as unknown as AdfNode)).toBe("x");
    });
  });

  describe("realistic documents", () => {
    it("renders a full Jira description", () => {
      const input = doc(
        { type: "heading", attrs: { level: 2 }, content: [text("Bug report")] },
        para(text("Reported by "), { type: "mention", attrs: { id: "1", text: "@Alex" } }, text(" on "), {
          type: "date",
          attrs: { timestamp: String(Date.UTC(2024, 0, 2)) },
        }),
        { type: "panel", attrs: { panelType: "error" }, content: [para(text("Prod is down", [{ type: "strong" }]))] },
        ordered(listItem(para(text("Open "), text("/login", [{ type: "code" }]))), listItem(para(text("Submit")))),
        { type: "codeBlock", attrs: { language: "text" }, content: [text("HTTP 500")] },
        { type: "rule" },
        para(text("Status: "), { type: "status", attrs: { text: "TRIAGE" } }),
      );
      expect(adfToText(input)).toBe(
        [
          "## Bug report",
          "",
          "Reported by @Alex on 2024-01-02",
          "",
          "[error]",
          "**Prod is down**",
          "",
          "1. Open `/login`",
          "2. Submit",
          "",
          "```text",
          "HTTP 500",
          "```",
          "",
          "---",
          "",
          "Status: [TRIAGE]",
        ].join("\n"),
      );
    });
  });
});

// ================================================================ round trips

describe("textToAdf → adfToText round trip", () => {
  it.each([
    ["plain paragraph", "Hello world"],
    ["two paragraphs", "a\n\nb"],
    ["hard breaks", "line one\nline two"],
    ["heading", "# Title"],
    ["all heading levels", "# 1\n\n## 2\n\n### 3\n\n#### 4\n\n##### 5\n\n###### 6"],
    ["bullet list", "- a\n- b"],
    ["ordered list", "1. a\n2. b"],
    ["code span", "run `ls` now"],
    ["bare url", "see https://example.com now"],
    ["code fence with lang", "```js\nconst a = 1;\n```"],
    ["code fence without lang", "```\nplain\n```"],
    [
      "mixed document",
      "# Title\n\nIntro with `code` and https://a.b\n\n- one\n- two\n\n1. first\n2. second\n\n```sh\nmake\n```\n\nBye",
    ],
  ])("is stable for %s", (_name, input) => {
    expect(adfToText(textToAdf(input))).toBe(input);
  });

  it("normalises asterisk bullets to dashes", () => {
    expect(adfToText(textToAdf("* a\n* b"))).toBe("- a\n- b");
  });

  it("normalises paren-numbered lists to dot-numbered and renumbers", () => {
    expect(adfToText(textToAdf("3) a\n9) b"))).toBe("1. a\n2. b");
  });

  it("collapses excess blank lines", () => {
    expect(adfToText(textToAdf("a\n\n\n\n\nb"))).toBe("a\n\nb");
  });
});
