/**
 * Atlassian Document Format helpers. Jira Cloud v3 stores descriptions and
 * comments as ADF; tools accept and return plain text and convert at the edge.
 */

export interface AdfNode {
  type: string;
  text?: string;
  attrs?: Record<string, any>;
  content?: AdfNode[];
  marks?: { type: string; attrs?: Record<string, any> }[];
}

/** Plain text (with light markdown: blank-line paragraphs, "- " bullets, "1. " numbers, "# " headings, ``` fences) → ADF. */
export function textToAdf(text: string): AdfNode {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const content: AdfNode[] = [];
  let i = 0;

  const para = (buf: string[]) => {
    if (buf.length) content.push({ type: "paragraph", content: inline(buf.join("\n")) });
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
      i++; // closing fence
      content.push({
        type: "codeBlock",
        ...(lang ? { attrs: { language: lang } } : {}),
        content: [{ type: "text", text: code.join("\n") }],
      });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      content.push({
        type: "heading",
        attrs: { level: heading[1].length },
        content: [{ type: "text", text: heading[2] }],
      });
      i++;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const re = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/;
      const items: AdfNode[] = [];
      while (i < lines.length && re.test(lines[i])) {
        items.push({
          type: "listItem",
          content: [{ type: "paragraph", content: inline(lines[i].replace(re, "")) }],
        });
        i++;
      }
      content.push({ type: ordered ? "orderedList" : "bulletList", content: items });
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("```") &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i])
    ) {
      buf.push(lines[i++]);
    }
    para(buf);
  }

  if (content.length === 0) content.push({ type: "paragraph", content: [] });
  return { type: "doc", version: 1, content } as AdfNode;
}

/** Inline text with hard breaks; recognises `code` spans and bare URLs. */
function inline(text: string): AdfNode[] {
  const nodes: AdfNode[] = [];
  const parts = text.split("\n");
  parts.forEach((part, idx) => {
    if (idx > 0) nodes.push({ type: "hardBreak" });
    const re = /(`[^`]+`)|(https?:\/\/[^\s<>"')\]]+)/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(part))) {
      if (m.index > last) nodes.push({ type: "text", text: part.slice(last, m.index) });
      if (m[1]) nodes.push({ type: "text", text: m[1].slice(1, -1), marks: [{ type: "code" }] });
      else nodes.push({ type: "text", text: m[2], marks: [{ type: "link", attrs: { href: m[2] } }] });
      last = m.index + m[0].length;
    }
    if (last < part.length) nodes.push({ type: "text", text: part.slice(last) });
  });
  return nodes.filter((n) => n.type !== "text" || (n.text ?? "").length > 0);
}

/** ADF → readable plain text. Accepts a string (legacy/wiki) unchanged. */
export function adfToText(doc: unknown): string {
  if (doc == null) return "";
  if (typeof doc === "string") return doc;
  const node = doc as AdfNode;
  return render(node, 0).replace(/\n{3,}/g, "\n\n").trim();
}

function render(node: AdfNode, depth: number, index?: number): string {
  const children = (sep = "") => (node.content ?? []).map((c, i) => render(c, depth, i)).join(sep);
  switch (node.type) {
    case "doc":
      return children("\n");
    case "paragraph":
      return children() + "\n";
    case "heading": {
      const level = node.attrs?.level ?? 1;
      return `${"#".repeat(level)} ${children()}\n`;
    }
    case "text": {
      const raw = node.text ?? "";
      // Keep surrounding whitespace outside the markers: "** bold**" reads badly.
      const lead = raw.match(/^\s*/)?.[0] ?? "";
      const trail = raw.match(/\s*$/)?.[0] ?? "";
      let t = raw.trim();
      if (!t) return raw;
      for (const mark of node.marks ?? []) {
        if (mark.type === "code") t = `\`${t}\``;
        if (mark.type === "strong") t = `**${t}**`;
        if (mark.type === "em") t = `_${t}_`;
        if (mark.type === "strike") t = `~~${t}~~`;
        if (mark.type === "link" && mark.attrs?.href && mark.attrs.href !== t) t = `${t} (${mark.attrs.href})`;
      }
      return lead + t + trail;
    }
    case "hardBreak":
      return "\n";
    case "bulletList":
      return (node.content ?? []).map((li) => renderListItem(li, depth, "-")).join("") + "\n";
    case "orderedList": {
      const start = node.attrs?.order ?? 1;
      return (node.content ?? []).map((li, i) => renderListItem(li, depth, `${start + i}.`)).join("") + "\n";
    }
    case "listItem":
      return renderListItem(node, depth, "-");
    case "codeBlock": {
      const lang = node.attrs?.language ?? "";
      return `\`\`\`${lang}\n${children()}\n\`\`\`\n`;
    }
    case "blockquote":
      return children().split("\n").filter(Boolean).map((l) => `> ${l}`).join("\n") + "\n";
    case "rule":
      return "---\n";
    case "mention":
      return node.attrs?.text ?? `@${node.attrs?.id ?? "user"}`;
    case "emoji":
      return node.attrs?.text ?? node.attrs?.shortName ?? "";
    case "inlineCard":
    case "blockCard":
    case "embedCard":
      return (node.attrs?.url ?? "") + (node.type === "inlineCard" ? "" : "\n");
    case "date":
      return node.attrs?.timestamp ? new Date(Number(node.attrs.timestamp)).toISOString().slice(0, 10) : "";
    case "status":
      return `[${node.attrs?.text ?? ""}]`;
    case "panel":
      return `[${node.attrs?.panelType ?? "panel"}]\n${children()}`;
    case "table":
      return children("") + "\n";
    case "tableRow":
      return "| " + (node.content ?? []).map((c) => render(c, depth).trim().replace(/\n/g, " ")).join(" | ") + " |\n";
    case "tableHeader":
    case "tableCell":
      return children(" ");
    case "mediaSingle":
    case "mediaGroup":
    case "media":
      return node.type === "media" ? `[attachment${node.attrs?.alt ? `: ${node.attrs.alt}` : ""}]` : children() + "\n";
    case "expand":
    case "nestedExpand":
      return `${node.attrs?.title ? `${node.attrs.title}\n` : ""}${children()}`;
    default:
      return children();
  }
}

function renderListItem(li: AdfNode, depth: number, bullet: string): string {
  const indent = "  ".repeat(depth);
  const parts = (li.content ?? []).map((c) => {
    if (c.type === "bulletList" || c.type === "orderedList") return render(c, depth + 1);
    return render(c, depth).trimEnd();
  });
  const [first, ...rest] = parts;
  return `${indent}${bullet} ${first ?? ""}\n${rest.join("")}`;
}
