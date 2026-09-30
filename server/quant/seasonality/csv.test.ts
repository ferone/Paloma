import { describe, it, expect } from "vitest";
import { parseSpreadCsv } from "./csv.js";

describe("parseSpreadCsv", () => {
  it("parses date,spread with a header row skipped, ascending", () => {
    const csv = `date,spread\n2020-03-02,5.5\n2020-01-02,4.0\n2020-02-03,4.8`;
    const r = parseSpreadCsv(csv);
    expect(r.rows).toBe(3);
    expect(r.errors).toEqual([]);
    expect(r.points.map((p) => p.date)).toEqual(["2020-01-02", "2020-02-03", "2020-03-02"]);
    expect(r.points[2].value).toBe(5.5);
  });

  it("parses date,leg1,leg2 into spread = leg1 − leg2", () => {
    const csv = `2021-06-01,150,145\n2021-06-02,160,152`;
    const r = parseSpreadCsv(csv);
    expect(r.points[0].value).toBe(5);
    expect(r.points[1].value).toBe(8);
  });

  it("reports malformed rows without fabricating data", () => {
    const csv = `date,spread\n2020-01-02,4.0\n2020-13-99,oops\nnotadate,1\n2020-02-02,abc`;
    const r = parseSpreadCsv(csv);
    expect(r.rows).toBe(1); // only the one good row
    expect(r.points).toHaveLength(1);
    expect(r.errors.length).toBeGreaterThanOrEqual(2);
  });

  it("handles semicolon/tab delimiters and blank lines", () => {
    const csv = `2020-01-02;4.0\n\n2020-01-03\t5.0\n`;
    const r = parseSpreadCsv(csv);
    expect(r.points.map((p) => p.value)).toEqual([4, 5]);
  });
});
