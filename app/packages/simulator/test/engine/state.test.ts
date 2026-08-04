import { describe, expect, it } from "vitest";
import { HistoryKey, Store } from "../../src/engine/state";

describe("Store dot paths", () => {
  it("reads and writes nested paths, creating intermediates", () => {
    const st = Store.seed({});
    st.set("docker.container.running", true);
    expect(st.get("docker.container.running")).toEqual({
      value: true,
      present: true,
    });
    expect(st.get("docker.container")).toEqual({
      value: { running: true },
      present: true,
    });
  });

  it("reports a missing path as absent rather than undefined-valued", () => {
    // `present` is load-bearing: match.ts treats an absent key as its zero
    // value, so "absent" and "explicitly false" must stay distinguishable here.
    const st = Store.seed({ running: false });
    expect(st.get("nope")).toEqual({ value: undefined, present: false });
    expect(st.get("running")).toEqual({ value: false, present: true });
  });

  it("reports a path that traverses a non-object as absent", () => {
    const st = Store.seed({ name: "web" });
    expect(st.get("name.length").present).toBe(false);
  });

  it("replaces a non-object encountered mid-path", () => {
    const st = Store.seed({ a: "scalar" });
    st.set("a.b", 1);
    expect(st.get("a.b").value).toBe(1);
  });

  it("ignores an empty path", () => {
    const st = Store.seed({ a: 1 });
    st.set("", 2);
    expect(st.snapshot()).toEqual({ a: 1 });
    expect(st.get("").present).toBe(false);
  });
});

describe("Store append", () => {
  it("creates the list when absent", () => {
    const st = Store.seed({});
    st.append("images", "nginx");
    expect(st.get("images").value).toEqual(["nginx"]);
  });

  it("appends to an existing list", () => {
    const st = Store.seed({ images: ["nginx"] });
    st.append("images", "redis");
    expect(st.get("images").value).toEqual(["nginx", "redis"]);
  });

  it("replaces a non-list value with a single-element list", () => {
    const st = Store.seed({ images: "nginx" });
    st.append("images", "redis");
    expect(st.get("images").value).toEqual(["redis"]);
  });

  it("records commands in the reserved history list", () => {
    const st = Store.seed({});
    st.appendHistory("docker ps");
    st.appendHistory("docker run nginx");
    expect(st.get(HistoryKey).value).toEqual(["docker ps", "docker run nginx"]);
  });
});

describe("Store isolation", () => {
  it("deep-copies the seed so mutations never leak into the parsed Lab", () => {
    const seed = { docker: { running: false } };
    const st = Store.seed(seed);
    st.set("docker.running", true);
    expect(seed.docker.running).toBe(false);
  });

  it("deep-copies restored data", () => {
    const saved = { docker: { running: true } };
    const st = Store.restore(saved);
    st.set("docker.running", false);
    expect(saved.docker.running).toBe(true);
  });

  it("returns a snapshot that cannot mutate the store", () => {
    const st = Store.seed({ docker: { running: true } });
    const snap = st.snapshot();
    (snap.docker as Record<string, unknown>).running = false;
    expect(st.get("docker.running").value).toBe(true);
  });

  it("treats an undefined seed as empty", () => {
    expect(Store.seed(undefined).snapshot()).toEqual({});
  });
});
