import { describe, expect, it } from "vitest";
import { getQuestionDistribution, parseActaRatio } from "./acta";

describe("ACTA ratio parsing", () => {
  it("parses labelled percentage ratios", () => {
    expect(parseActaRatio("L1: 20%; L2: 60%; L3: 20%")).toEqual({
      L1: 20,
      L2: 60,
      L3: 20,
    });
  });

  it("rejects ratios that do not sum to 100", () => {
    expect(parseActaRatio("L1: 20%; L2: 20%; L3: 20%")).toBeNull();
  });

  it("returns exactly fifteen distributed starter questions", () => {
    expect(getQuestionDistribution("L1: 20%; L2: 60%; L3: 20%")).toEqual({
      L1: 3,
      L2: 9,
      L3: 3,
    });
  });
});
