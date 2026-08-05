// Splits one chapter of deck markdown into individual slides.
//
// A slide break is a line containing only `---`. That's reveal.js's convention,
// so it's already in authors' fingers, and it means a chapter file still reads as
// an ordinary markdown document rather than a config file.
//
// Two things make this fiddlier than `text.split("---")`, and both bite in real
// decks:
//
//   1. A `---` inside a fenced code block is CONTENT (a YAML document separator,
//      a shell heredoc, a diff hunk). Splitting there would tear the fence in
//      half and every slide after it would render as garbage. So the scan tracks
//      fence state, including the tilde form and the longer fences authors use to
//      show a fence inside a fence.
//   2. A `---` on the FIRST line opens YAML front matter, not a slide break.
//
// Speaker notes use reveal's convention too: a `Note:` line, and everything
// after it, belongs to the presenter rather than the slide.

/** A line that is exactly `---` (optionally indented) — the slide separator. */
const SEPARATOR = /^\s*---\s*$/;

/** Opens or closes a fenced code block: ``` or ~~~, three or more. */
const FENCE = /^\s*(`{3,}|~{3,})/;

/** The speaker-notes marker. Everything from here to the end of the slide. */
const NOTE = /^\s*Note:\s?(.*)$/;

/**
 * Splits chapter markdown into slide chunks on `---` lines that are not inside a
 * fenced code block. Returns the raw text of each slide, in order.
 */
export function splitChunks(markdown) {
  const lines = (markdown ?? "").split("\n");
  const chunks = [];
  let current = [];

  // The fence we're inside, or null. Stored as the literal opening marker so a
  // ```` fence isn't closed by a ``` line within it (which is exactly how a
  // lab's markdown shows a code fence to the reader).
  let fence = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = FENCE.exec(line);

    if (fence) {
      // Inside a fence: only a marker at least as long as the opener closes it.
      if (
        fenceMatch &&
        fenceMatch[1][0] === fence[0] &&
        fenceMatch[1].length >= fence.length
      ) {
        fence = null;
      }
      current.push(line);
      continue;
    }

    if (fenceMatch) {
      fence = fenceMatch[1];
      current.push(line);
      continue;
    }

    // A `---` on the very first line opens front matter, so it is not a break.
    if (SEPARATOR.test(line) && i > 0) {
      chunks.push(current.join("\n"));
      current = [];
      continue;
    }

    current.push(line);
  }
  chunks.push(current.join("\n"));

  return chunks;
}

/**
 * Separates a slide's body from its speaker notes. Everything from the first
 * `Note:` line to the end of the chunk is notes; the rest is the slide.
 */
export function extractNotes(chunk) {
  const lines = chunk.split("\n");
  const at = lines.findIndex((l) => NOTE.test(l));
  if (at < 0) return { content: chunk, notes: "" };

  const firstNoteLine = NOTE.exec(lines[at])[1];
  const notes = [firstNoteLine, ...lines.slice(at + 1)].join("\n").trim();
  return { content: lines.slice(0, at).join("\n"), notes };
}

/**
 * Parses one chapter of deck markdown into slides.
 *
 * Each slide gets a STABLE id — `<chapterId>-<n>`, numbered from 1 — used as the
 * route segment and as the tracking key. It's positional rather than derived
 * from a heading because a deck's slides are frequently untitled (an image, a
 * single line of text), and because renaming a heading shouldn't silently
 * invalidate a learner's recorded progress.
 *
 * Blank chunks are dropped, so a stray extra `---` or a trailing separator at
 * the end of a file doesn't produce an empty slide.
 *
 * @param {string} markdown  the chapter's raw markdown
 * @param {object} opts
 * @param {string} opts.chapterId  slug of the chapter, used to build slide ids
 * @param {string} [opts.baseUrl]  base for resolving relative asset paths
 * @returns {{id: string, chapterId: string, content: string, notes: string, baseUrl?: string}[]}
 */
export function parseSlides(markdown, { chapterId, baseUrl } = {}) {
  return (
    splitChunks(markdown)
      .map((chunk) => extractNotes(chunk))
      .map(({ content, notes }) => ({ content: content.trim(), notes }))
      // A chunk with no body AND no notes is nothing at all — drop it. One with
      // only notes is kept: a deliberate "say this, show nothing" beat.
      .filter((slide) => slide.content !== "" || slide.notes !== "")
      .map((slide, index) => ({
        id: `${chapterId}-${index + 1}`,
        chapterId,
        baseUrl,
        ...slide,
      }))
  );
}
