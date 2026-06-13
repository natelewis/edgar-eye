import * as cheerio from "cheerio";

const XBRL_TAG_PATTERN =
  /<\/?(?:ix:[^>]+|xbrli:[^>]+|link:[^>]+|xbrldi:[^>]+)[^>]*>/gi;
const SCRIPT_STYLE_PATTERN = /<(script|style)[^>]*>[\s\S]*?<\/\1>/gi;
const HTML_TAG_PATTERN = /<[^>]+>/g;
const INLINE_WHITESPACE_PATTERN = /[^\S\n]+/g;
const PARAGRAPH_BREAK_PATTERN = /\n{3,}/g;

const LEAF_SELECTORS = "p, td, li, span, h1, h2, h3, h4, h5, h6";

export function stripHtml(raw: string): string {
  const withoutScripts = raw.replace(SCRIPT_STYLE_PATTERN, " ");
  const withoutXbrl = withoutScripts.replace(XBRL_TAG_PATTERN, " ");

  const $ = cheerio.load(withoutXbrl, { xml: false });
  $("script, style, noscript").remove();

  const seen = new Set<string>();
  const textBlocks: string[] = [];

  // Collect leaf-level blocks only to avoid duplicating nested div/span text.
  $(LEAF_SELECTORS).each((_, el) => {
    const children = $(el).children();
    if (children.length > 0) {
      return;
    }

    const text = $(el)
      .text()
      .replace(INLINE_WHITESPACE_PATTERN, " ")
      .trim();

    if (text.length === 0 || seen.has(text)) {
      return;
    }

    seen.add(text);
    textBlocks.push(text);
  });

  let narrative =
    textBlocks.length > 0
      ? textBlocks.join("\n\n")
      : $.root().text().replace(INLINE_WHITESPACE_PATTERN, " ").trim();

  narrative = narrative.replace(HTML_TAG_PATTERN, " ");
  narrative = narrative.replace(INLINE_WHITESPACE_PATTERN, " ").trim();
  narrative = narrative.replace(PARAGRAPH_BREAK_PATTERN, "\n\n");

  return narrative;
}
