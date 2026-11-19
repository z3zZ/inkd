import { describe, expect, it } from "vitest";
import { formatBytes, formatDuration } from "./ModelSetup";

describe("download progress text", () => {
  it("shows sizes in MB, and GB from 1 GB up", () => {
    expect(formatBytes(1044328)).toBe("1 MB");
    expect(formatBytes(343553824)).toBe("328 MB");
    expect(formatBytes(1253789769)).toBe("1.17 GB");
  });

  it("rounds time left to whole minutes", () => {
    expect(formatDuration(12)).toBe("under a minute");
    expect(formatDuration(80)).toBe("about 1 minute");
    expect(formatDuration(600)).toBe("about 10 minutes");
    expect(formatDuration(Infinity)).toBe("");
  });
});
