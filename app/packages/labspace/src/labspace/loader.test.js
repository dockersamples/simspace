import { describe, expect, it, vi } from "vitest";
import { loadLabspace } from "./loader";

// The loader is the package's front door: it turns one labspace.yaml URL into
// the config every other part of the runtime reads. Two things make it worth
// pinning down beyond "it parses YAML".
//
// The INJECTED FETCHER is what lets a host resolve a lab at build time — Docker
// Learn reads its scenario off disk in Astro frontmatter so the instructions end
// up in the served HTML. If `fetchText` ever stops being honoured, that path
// silently falls back to a network fetch that cannot work in a Node build.
//
// RELATIVE RESOLUTION is the contract with authors: everything a labspace.yaml
// names is relative to itself, so a lab directory can be moved or served from a
// subpath without editing it. Getting this wrong breaks every lab at once.

/** A fetcher over an in-memory file tree, standing in for the network/disk. */
function fakeFetcher(files) {
  const calls = [];
  const fetchText = vi.fn(async (url) => {
    calls.push(url);
    if (!(url in files)) throw new Error(`Failed to fetch ${url}`);
    return files[url];
  });
  return { fetchText, calls };
}

const BASE = "https://example.test/labs/demo/";
const LAB_URL = `${BASE}labspace.yaml`;

function lab(yaml, extra = {}) {
  return {
    [LAB_URL]: yaml,
    [`${BASE}simulator.yaml`]: "version: 2\nscenarios: []\n",
    ...extra,
  };
}

describe("loadLabspace", () => {
  it("reads every file through the injected fetcher, never the network", async () => {
    const { fetchText, calls } = fakeFetcher(
      lab(
        `
title: Demo
simulator: simulator.yaml
sections:
  - title: Intro
    contentPath: 00-intro.md
`,
        { [`${BASE}00-intro.md`]: "# Intro" },
      ),
    );
    // Any real fetch would blow up here rather than quietly working.
    const globalFetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("network used"));

    const config = await loadLabspace(LAB_URL, { fetchText });

    expect(globalFetch).not.toHaveBeenCalled();
    // Which files, not in which order — the loader fetches sections and the
    // simulator concurrently, and that is its business.
    expect(calls.sort()).toEqual(
      [LAB_URL, `${BASE}simulator.yaml`, `${BASE}00-intro.md`].sort(),
    );
    expect(config.title).toBe("Demo");
    expect(config.sections[0].contentRaw).toBe("# Intro");
    globalFetch.mockRestore();
  });

  it("resolves everything relative to the labspace, including nested sections", async () => {
    const { fetchText } = fakeFetcher(
      lab(
        `
title: Demo
simulator: sim/simulator.yaml
sections:
  - title: Intro
    contentPath: chapters/one/intro.md
`,
        {
          [`${BASE}sim/simulator.yaml`]: "version: 2\n",
          [`${BASE}chapters/one/intro.md`]: "hi",
        },
      ),
    );

    const config = await loadLabspace(LAB_URL, { fetchText });

    expect(config.baseUrl).toBe(BASE);
    // A section's own directory, so `images/x.png` beside a nested markdown file
    // resolves against that file rather than the lab root.
    expect(config.sections[0].baseUrl).toBe(`${BASE}chapters/one/`);
  });

  it("survives being served from a subpath", async () => {
    const base = "https://docs.example/learn/simspaces/demo/";
    const { fetchText } = fakeFetcher({
      [`${base}labspace.yaml`]:
        "title: Demo\nsimulator: simulator.yaml\nsections: []\n",
      [`${base}simulator.yaml`]: "version: 2\n",
    });

    const config = await loadLabspace(`${base}labspace.yaml`, { fetchText });

    expect(config.baseUrl).toBe(base);
  });

  it("requires a simulator for a lab", async () => {
    const { fetchText } = fakeFetcher({
      [LAB_URL]: "title: Demo\nsections: []\n",
    });

    await expect(loadLabspace(LAB_URL, { fetchText })).rejects.toThrow(
      /missing a `simulator` path/,
    );
  });

  describe("slide decks", () => {
    const DECK = `
kind: slides
title: Deck
slides:
  - contentPath: 01-why.md
`;

    it("splits chapters with the injected splitter", async () => {
      const { fetchText } = fakeFetcher({
        [LAB_URL]: DECK,
        [`${BASE}01-why.md`]: "a\n---\nb",
      });
      const parseSlides = vi.fn(() => [{ id: "s1" }, { id: "s2" }]);

      const config = await loadLabspace(LAB_URL, { fetchText, parseSlides });

      expect(config.kind).toBe("slides");
      expect(parseSlides).toHaveBeenCalledWith("a\n---\nb", {
        chapterId: "chapter-1",
        baseUrl: BASE,
      });
      expect(config.sections[0].slides).toHaveLength(2);
      // A deck needs no simulator — no live demo is a valid deck.
      expect(config.simulatorSpec).toBeNull();
    });

    it("refuses to load a deck in a host that cannot render one", async () => {
      const { fetchText } = fakeFetcher({
        [LAB_URL]: DECK,
        [`${BASE}01-why.md`]: "a",
      });

      // Loudly, rather than returning chapters with zero slides — that reads as
      // broken content instead of "this host doesn't do decks".
      await expect(loadLabspace(LAB_URL, { fetchText })).rejects.toThrow(
        /does not render slide decks/,
      );
    });
  });

  describe("defaults authors rely on", () => {
    it("gives a lab one terminal when it declares none", async () => {
      const { fetchText } = fakeFetcher(
        lab("title: Demo\nsimulator: simulator.yaml\nsections: []\n"),
      );

      const config = await loadLabspace(LAB_URL, { fetchText });

      expect(config.terminals).toEqual([
        { id: "terminal", title: "Terminal", icon: "terminal" },
      ]);
    });

    it("derives ids from titles for sections, steps, and services", async () => {
      const { fetchText } = fakeFetcher(
        lab(
          `
title: Demo
simulator: simulator.yaml
sections:
  - title: The Docker CLI
    contentPath: a.md
    steps:
      - title: Run a container
      - id: explicit-id
        title: Stop it
services:
  - title: My Docs
    url: https://example.com
`,
          { [`${BASE}a.md`]: "" },
        ),
      );

      const config = await loadLabspace(LAB_URL, { fetchText });

      expect(config.sections[0].id).toBe("the-docker-cli");
      expect(config.sections[0].steps).toEqual([
        { id: "run-a-container", title: "Run a container" },
        { id: "explicit-id", title: "Stop it" },
      ]);
      expect(config.services[0].id).toBe("my-docs");
    });
  });

  describe("the tracking directive", () => {
    // `?? null`, not `|| null`: `false` is a lab's explicit opt-out and must
    // survive to the tracking layer, where it means something different from
    // "inherit the deployment default".
    it.each([
      ["absent", "title: D\nsimulator: simulator.yaml\n", null],
      [
        "false",
        "title: D\nsimulator: simulator.yaml\ntracking: false\n",
        false,
      ],
    ])("preserves %s", async (_label, yaml, expected) => {
      const { fetchText } = fakeFetcher(lab(yaml));
      const config = await loadLabspace(LAB_URL, { fetchText });
      expect(config.tracking).toBe(expected);
    });

    it("passes an overrides object through untouched", async () => {
      const { fetchText } = fakeFetcher(
        lab(
          "title: D\nsimulator: simulator.yaml\ntracking:\n  presence: false\n",
        ),
      );
      const config = await loadLabspace(LAB_URL, { fetchText });
      expect(config.tracking).toEqual({ presence: false });
    });
  });
});
