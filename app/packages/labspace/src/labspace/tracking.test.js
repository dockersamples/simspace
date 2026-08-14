import { describe, expect, it } from "vitest";
import { resolveTracking } from "./tracking";

// One lab's effective tracking config comes from two places: the deployment
// default (config.json) and the lab's own `tracking:` directive. The distinction
// that matters is between "this lab said nothing" and "this lab said no" — they
// are both falsy in YAML, and only one of them should inherit the default.

const BASE = { endpoint: "https://pulse.example/", labId: "deployment" };

describe("resolveTracking", () => {
  it("inherits the deployment default when the lab says nothing", () => {
    expect(resolveTracking(BASE, null, "my-lab")).toEqual({
      endpoint: "https://pulse.example",
      labId: "deployment",
      presence: true,
      identity: "optional-name",
    });
  });

  it("treats `tracking: false` as an opt-out, not as inheritance", () => {
    expect(resolveTracking(BASE, false, "my-lab")).toBeNull();
  });

  it("is off when nothing configures an endpoint", () => {
    expect(resolveTracking(null, null, "my-lab")).toBeNull();
    expect(resolveTracking({}, {}, "my-lab")).toBeNull();
  });

  it("merges the lab's overrides over the default", () => {
    expect(resolveTracking(BASE, { presence: false }, "my-lab")).toMatchObject({
      endpoint: "https://pulse.example",
      presence: false,
    });
    expect(
      resolveTracking(BASE, { endpoint: "https://other.example" }, "my-lab"),
    ).toMatchObject({ endpoint: "https://other.example" });
  });

  it("falls back to the lab's own key when no labId is configured", () => {
    expect(
      resolveTracking({ endpoint: "https://pulse.example" }, null, "my-lab"),
    ).toMatchObject({ labId: "my-lab" });
  });

  // Events are posted to `${endpoint}/events`, so a configured trailing slash
  // would otherwise produce `//events`.
  it("strips trailing slashes from the endpoint", () => {
    expect(
      resolveTracking({ endpoint: "https://pulse.example///" }, null, "l"),
    ).toMatchObject({ endpoint: "https://pulse.example" });
  });

  describe("defaults that must stay opt-OUT rather than opt-in", () => {
    it("keeps presence on unless explicitly disabled", () => {
      expect(resolveTracking(BASE, { presence: undefined }, "l").presence).toBe(
        true,
      );
    });

    it("allows a display name unless identity is exactly 'anonymous'", () => {
      expect(resolveTracking(BASE, null, "l").identity).toBe("optional-name");
      expect(
        resolveTracking(BASE, { identity: "anonymous" }, "l").identity,
      ).toBe("anonymous");
      expect(resolveTracking(BASE, { identity: "wat" }, "l").identity).toBe(
        "optional-name",
      );
    });
  });
});
