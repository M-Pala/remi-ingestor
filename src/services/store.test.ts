import { beforeEach, describe, expect, it } from "@jest/globals";
import { nextSequenceForGroup, resetSequenceCounters } from "./store.js";

describe("nextSequenceForGroup", () => {
  beforeEach(() => {
    resetSequenceCounters();
  });

  it("returns monotonically increasing values for the same group", () => {
    const groupId = "group-a";
    expect(nextSequenceForGroup(groupId)).toBe(1);
    expect(nextSequenceForGroup(groupId)).toBe(2);
    expect(nextSequenceForGroup(groupId)).toBe(3);
  });

  it("assigns unique sequences under concurrent reservation", async () => {
    const groupId = "group-concurrent";
    const sequences = await Promise.all(
      Array.from({ length: 20 }, () =>
        Promise.resolve(nextSequenceForGroup(groupId)),
      ),
    );
    const unique = new Set(sequences);
    expect(unique.size).toBe(20);
    expect(Math.min(...sequences)).toBe(1);
    expect(Math.max(...sequences)).toBe(20);
  });

  it("keeps independent counters per group", () => {
    expect(nextSequenceForGroup("group-x")).toBe(1);
    expect(nextSequenceForGroup("group-y")).toBe(1);
    expect(nextSequenceForGroup("group-x")).toBe(2);
  });
});
