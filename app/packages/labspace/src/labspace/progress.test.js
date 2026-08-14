import { beforeEach, describe, expect, it } from "vitest";
import * as progress from "./progress";
import { scopedKey } from "./storage";

// The learner's own record: which steps they finished, and the anonymous handle
// those completions belong to. It is the layer that keeps working when there is
// no analytics adapter at all, so it has to be right on its own.

beforeEach(() => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
});

describe("scopedKey", () => {
  it("suffixes a key with the lab, so two labs cannot collide", () => {
    expect(scopedKey("simspace:engine", "tour")).toBe("simspace:engine:tour");
  });

  it("leaves the key alone when there is no lab key", () => {
    expect(scopedKey("simspace:engine", "")).toBe("simspace:engine");
  });
});

describe("progress", () => {
  it("records a completion and reads it back", () => {
    progress.markComplete("lab", "run-a-container", { command: "docker run" });

    expect(progress.completedSteps("lab")).toHaveProperty("run-a-container");
    expect(progress.completedSteps("lab")["run-a-container"].command).toBe(
      "docker run",
    );
  });

  it("keeps each lab's completions to itself", () => {
    progress.markComplete("lab-a", "step-1");

    expect(progress.completedSteps("lab-b")).toEqual({});
  });

  it("is idempotent, and keeps the FIRST completion's timestamp", () => {
    progress.markComplete("lab", "step-1");
    const first = progress.completedSteps("lab")["step-1"].at;

    progress.markComplete("lab", "step-1", { command: "run again" });

    const after = progress.completedSteps("lab")["step-1"];
    expect(after.at).toBe(first);
    expect(Object.keys(progress.completedSteps("lab"))).toEqual(["step-1"]);
  });

  it("ignores a completion with no step id", () => {
    expect(progress.markComplete("lab", undefined)).toEqual({});
  });

  describe("resetting", () => {
    it("clears completions but keeps who the learner is", () => {
      const { actor } = progress.getActor("lab", {});
      progress.markComplete("lab", "step-1");

      progress.resetProgress("lab");

      expect(progress.completedSteps("lab")).toEqual({});
      // Losing the actor would make one learner look like two to the backend.
      expect(progress.getActor("lab", {}).actor.id).toBe(actor.id);
    });
  });

  describe("a version bump", () => {
    // `version:` in labspace.yaml exists so an author can say "the steps
    // changed". Stale check-marks against steps that no longer exist would show
    // a lab as part-finished that the learner has never seen.
    it("invalidates completions when the lab's version changes", () => {
      progress.loadProgress("lab", { labId: "lab", labVersion: "1" });
      progress.markComplete("lab", "step-1");

      const store = progress.loadProgress("lab", {
        labId: "lab",
        labVersion: "2",
      });

      expect(store.completed).toEqual({});
    });

    it("keeps completions when the version is unchanged", () => {
      progress.loadProgress("lab", { labId: "lab", labVersion: "1" });
      progress.markComplete("lab", "step-1");

      const store = progress.loadProgress("lab", {
        labId: "lab",
        labVersion: "1",
      });

      expect(store.completed).toHaveProperty("step-1");
    });

    it("keeps the learner's identity across the bump", () => {
      const before = progress.getActor("lab", { labVersion: "1" }).actor.id;

      const after = progress.getActor("lab", { labVersion: "2" }).actor.id;

      expect(after).toBe(before);
    });
  });

  describe("finishing the lab", () => {
    it("records completion once, keeping the first timestamp", () => {
      progress.markLabComplete("lab");
      const first = progress.loadProgress("lab", {}).completedAt;

      progress.markLabComplete("lab");

      expect(progress.isLabComplete("lab")).toBe(true);
      expect(progress.loadProgress("lab", {}).completedAt).toBe(first);
    });

    it("reports an untouched lab as unfinished", () => {
      expect(progress.isLabComplete("never-opened")).toBe(false);
    });
  });

  describe("the anonymous avatar", () => {
    it("is stable for one id and differs across ids", () => {
      expect(progress.avatarFor("abc")).toEqual(progress.avatarFor("abc"));
      expect(progress.avatarFor("abc")).not.toEqual(progress.avatarFor("xyz"));
    });

    it("always produces a usable pair, even with no id", () => {
      const avatar = progress.avatarFor(undefined);
      expect(avatar.emoji).toBeTruthy();
      expect(avatar.color).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });

  describe("when storage is unavailable", () => {
    // Private-browsing quota errors, or a server render. Progress is
    // best-effort; taking the lab down with it would not be.
    it("degrades instead of throwing", () => {
      globalThis.localStorage = {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => {
          throw new Error("denied");
        },
        removeItem: () => {
          throw new Error("denied");
        },
      };

      expect(() => progress.markComplete("lab", "step-1")).not.toThrow();
      expect(progress.completedSteps("lab")).toEqual({});
      expect(progress.isLabComplete("lab")).toBe(false);
    });
  });
});
