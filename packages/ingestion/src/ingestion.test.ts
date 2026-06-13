import { describe, expect, it } from "vitest";
import { AccessionPredictor } from "./accession-predictor.js";
import { stripHtml } from "./html-stripper.js";

describe("stripHtml", () => {
  it("removes HTML tags and preserves narrative text", () => {
    const raw = `
      <html><body>
        <div><p>Item 1.01 Entry into a Material Definitive Agreement</p></div>
        <div><span>On June 12, 2026, Example Corp entered into a merger agreement.</span></div>
      </body></html>
    `;

    const result = stripHtml(raw);
    expect(result).toContain("Item 1.01 Entry into a Material Definitive Agreement");
    expect(result).toContain("merger agreement");
    expect(result).not.toContain("<div>");
  });

  it("does not duplicate nested paragraph text", () => {
    const raw = `
      <div>
        <p>This is a unique filing paragraph about executive leadership changes.</p>
      </div>
    `;

    const result = stripHtml(raw);
    const occurrences = result.split(
      "This is a unique filing paragraph about executive leadership changes.",
    ).length - 1;
    expect(occurrences).toBe(1);
  });

  it("keeps short but material table cell values", () => {
    const raw = `<table><tr><td>$4.25</td><td>2026-06-12</td></tr></table>`;
    const result = stripHtml(raw);
    expect(result).toContain("$4.25");
    expect(result).toContain("2026-06-12");
  });
});

describe("AccessionPredictor", () => {
  it("predicts the next accession numbers from a known filing", () => {
    const predictor = new AccessionPredictor();
    predictor.registerKnown("0000320193", "0000320193-25-000010");

    const next = predictor.predictNext("0000320193", 2);
    expect(next).toHaveLength(2);
    expect(next[0]?.accessionNumber).toBe("0000320193-25-000011");
    expect(next[1]?.accessionNumber).toBe("0000320193-25-000012");
  });

  it("advances the sequence after confirmation", () => {
    const predictor = new AccessionPredictor();
    predictor.registerKnown("0000320193", "0000320193-25-000010");
    predictor.confirm("0000320193", "0000320193-25-000011");

    const next = predictor.predictNext("0000320193", 1);
    expect(next[0]?.accessionNumber).toBe("0000320193-25-000012");
  });
});
