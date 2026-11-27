import { describe, expect, it } from "vitest";
import { solve } from "../math/engine";
import { flagFor } from "./LineController";

const read = (latex: string, confidence: number | null = 0.99) => ({ error: null, latex, confidence });

describe("flagFor", () => {
  it("leaves a confident, solved line unmarked", () => {
    expect(flagFor(read("3+4="), solve("3+4="))).toBeNull();
    expect(flagFor(read("x=5"), solve("x=5"))).toBeNull();
  });

  it("leaves lines that are not sums unmarked", () => {
    expect(flagFor(read("3+4"), solve("3+4"))).toBeNull();
    expect(flagFor(read("3+4=7"), solve("3+4=7"))).toBeNull();
  });

  it("marks a line that could not be read, and offers another try", () => {
    const flag = flagFor({ error: "GPU went away.", latex: null, confidence: null }, undefined);
    expect(flag).toMatchObject({ kind: "error", title: expect.stringContaining("GPU went away.") });
  });

  it("marks a sum that was read but has no answer, with what was read and why", () => {
    const flag = flagFor(read("\\[\\int x=\\]"), solve("\\int x="));
    expect(flag?.kind).toBe("unsolved");
    expect(flag?.title).toContain("\\int x=");
    expect(flag?.title).toContain("unsupported");
    expect(flagFor(read("2x="), solve("2x="))?.kind).toBe("unsolved");
    expect(flagFor(read("x=y+1"), solve("x=y+1"))?.kind).toBe("unsolved");
  });

  it("marks an answer that came from a doubtful reading", () => {
    expect(flagFor(read("3+4=", 0.62), solve("3+4="))).toMatchObject({
      kind: "unsure",
      title: expect.stringContaining("62%"),
    });
    expect(flagFor(read("3+4=", 0.8), solve("3+4="))).toBeNull();
  });

  it("trusts a reading typed in by hand", () => {
    expect(flagFor(read("3+4=", null), solve("3+4="))).toBeNull();
  });
});
