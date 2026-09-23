// Comment-preserving, minimal-diff YAML writing.
//
// The editor hands back a whole edited model (plain JSON). Writing it out with
// `stringify` would be correct and useless: a NO-OP round-trip of
// tour-of-docker/simulator.yaml rewrites 121 of its 602 lines (flow-collection
// padding, re-wrapped flow maps, quote styles). Lab YAML is hand-formatted and
// Prettier is kept away from `public/labs/**` on purpose, so an editor that
// reformats a fifth of the file on every save is one nobody points at a git
// repo.
//
// So: diff the edited model against the parsed document, walk the AST alongside
// it, and turn each difference into a TEXT SPLICE anchored to the node's source
// range. Untouched bytes stay untouched — comments, blank lines, quote styles,
// and flow/block choices included. A reorder cuts and re-inserts only the items
// that actually moved, carrying their original text and their comments with
// them.
//
// Two invariants make this safe to point at someone's repo:
//
//   1. The result is re-parsed and deep-compared to the intended model. A
//      mismatch is never written.
//   2. If the splice path can't hit the model exactly (or bails on overlapping
//      edits), we fall back to mutating the Document and re-serializing, which
//      is always correct but reformats. The caller is told which path ran, so
//      the UI can warn before the author commits.

import {
  Document,
  Pair,
  Scalar,
  YAMLMap,
  YAMLSeq,
  isMap,
  isPair,
  isScalar,
  isSeq,
  parseDocument,
  stringify,
} from "yaml";

export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };

/** One human-readable description of what the save changed. */
export interface PatchChange {
  /** Dot/bracket path into the model, e.g. `scenarios[3].then.output[1]`. */
  path: string;
  kind: "set" | "add" | "remove" | "move" | "replace";
  note?: string;
}

export interface PatchResult {
  text: string;
  changes: PatchChange[];
  /**
   * How the text was produced. "splice" touched only edited regions;
   * "rebuild" re-serialized the document and may have reformatted untouched
   * lines; "unchanged" means the model matched the file.
   */
  strategy: "unchanged" | "splice" | "rebuild";
}

/** Thrown internally when the splice path can't safely express an edit. */
class Bail extends Error {}

interface Splice {
  start: number;
  end: number;
  text: string;
  /**
   * Tie-breaker for splices sharing a start offset. Zero-length inserts get a
   * low order so they sort first and are therefore applied LAST (splices are
   * applied from the end of the file backwards) — an insertion at the front of
   * a block being removed then lands where the block was, which is exactly
   * what moving an item before a deleted one means.
   */
  order: number;
}

/** Order for a splice that consumes a range, sorting after any insert at it. */
const REPLACE_ORDER = Number.MAX_SAFE_INTEGER;

interface Ctx {
  text: string;
  splices: Splice[];
  changes: PatchChange[];
  seq: number;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * patchYaml writes `model` into `text`, changing as little of the file as
 * possible. It throws if neither strategy can reproduce the model exactly,
 * which means the caller never writes a file whose meaning it didn't intend.
 */
export function patchYaml(
  text: string,
  model: Json,
  opts: { debug?: (message: string, detail?: string) => void } = {},
): PatchResult {
  const doc = parseDocument(text);
  if (doc.errors.length) {
    throw new Error(
      `cannot patch a file that does not parse: ${doc.errors[0].message}`,
    );
  }
  const base = doc.toJS() as Json;
  if (deepEqual(base, model)) {
    return { text, changes: [], strategy: "unchanged" };
  }

  const ctx: Ctx = { text, splices: [], changes: [], seq: 0 };
  let spliced: string | null = null;
  try {
    diffNode(ctx, doc.contents as unknown, base, model, []);
    spliced = applySplices(text, ctx.splices);
  } catch (e) {
    if (!(e instanceof Bail)) throw e;
    opts.debug?.(`surgical write bailed: ${(e as Error).message}`);
    spliced = null;
  }

  if (spliced !== null && !reparses(spliced, model)) {
    opts.debug?.("surgical write did not reproduce the model", spliced);
    spliced = null;
  }
  if (spliced !== null) {
    return { text: spliced, changes: ctx.changes, strategy: "splice" };
  }

  // Fallback: mutate the document itself. Comments attached to surviving nodes
  // are kept, but the whole file is re-serialized.
  const rebuilt = rebuild(text, model);
  if (!reparses(rebuilt, model)) {
    throw new Error(
      "internal error: neither the surgical nor the rebuild write reproduced the edited model; nothing was written",
    );
  }
  return {
    text: rebuilt,
    changes: ctx.changes,
    strategy: "rebuild",
  };
}

function reparses(text: string, model: Json): boolean {
  const doc = parseDocument(text);
  if (doc.errors.length) return false;
  return deepEqual(doc.toJS() as Json, model);
}

// ── Diffing: model vs AST ────────────────────────────────────────────────────

function diffNode(
  ctx: Ctx,
  node: unknown,
  oldVal: Json,
  newVal: Json,
  path: (string | number)[],
): void {
  if (deepEqual(oldVal, newVal)) return;

  // No node to anchor to (an empty `output:`), or the value changed shape:
  // the parent re-renders it. Signalled by bailing to the parent's handler.
  if (node === null || node === undefined) throw new Bail("no node to anchor");

  if (isMap(node) && isPlainObject(oldVal) && isPlainObject(newVal)) {
    diffMap(ctx, node, oldVal, newVal, path);
    return;
  }
  if (isSeq(node) && Array.isArray(oldVal) && Array.isArray(newVal)) {
    diffSeq(ctx, node, oldVal, newVal, path);
    return;
  }
  if (isScalar(node) && isScalarValue(oldVal) && isScalarValue(newVal)) {
    replaceScalar(ctx, node, newVal, path);
    return;
  }
  // Shape change (scalar -> map, seq -> scalar, …): re-render this node.
  replaceNode(ctx, node, newVal, path, "replace");
}

function diffMap(
  ctx: Ctx,
  map: YAMLMap,
  oldObj: Record<string, Json>,
  newObj: Record<string, Json>,
  path: (string | number)[],
): void {
  const oldKeys = Object.keys(oldObj);
  const newKeys = Object.keys(newObj);
  const added = newKeys.filter((k) => !(k in oldObj));
  const removed = oldKeys.filter((k) => !(k in newObj));

  // A flow map can't take line-based edits: re-render the whole collection,
  // keeping it flow because that is the shape the author wrote.
  if (map.flow && (added.length || removed.length)) {
    replaceNode(ctx, map, newObj, path, "replace", true);
    return;
  }

  for (const key of removed) {
    const pair = pairFor(map, key);
    if (!pair) throw new Bail(`missing pair for removed key ${key}`);
    const start = blockStart(ctx, pair.key as unknown);
    const end = pairEnd(ctx, pair);
    push(ctx, { start, end, text: "", order: REPLACE_ORDER });
    record(ctx, path.concat(key), "remove");
  }

  for (const key of newKeys) {
    if (!(key in oldObj)) continue;
    const pair = pairFor(map, key);
    if (!pair) throw new Bail(`missing pair for key ${key}`);
    try {
      diffNode(ctx, pair.value, oldObj[key], newObj[key], path.concat(key));
    } catch (e) {
      if (!(e instanceof Bail)) throw e;
      // The value has no node of its own (was empty) — rewrite the whole pair.
      replacePairValue(ctx, pair, newObj[key], path.concat(key));
    }
  }

  if (added.length) insertKeys(ctx, map, newObj, added, path);
}

/**
 * insertKeys adds new mapping keys as whole lines, placed to keep the file's
 * existing key order where it is recognizable (`when` before `then`, `output`
 * before `exit`, …) and appended otherwise.
 */
function insertKeys(
  ctx: Ctx,
  map: YAMLMap,
  newObj: Record<string, Json>,
  added: string[],
  path: (string | number)[],
): void {
  const present = mapKeys(map);
  const lastPair = map.items[map.items.length - 1] as Pair | undefined;
  if (!lastPair) throw new Bail("cannot add a key to an empty mapping");

  const indent = lineIndentOf(ctx.text, (lastPair.key as Scalar).range![0]);
  const newKeys = Object.keys(newObj);

  for (const key of added) {
    // Anchor: the first already-present key that comes after this one in the
    // edited model's own key order.
    const idx = newKeys.indexOf(key);
    const after = newKeys.slice(idx + 1).find((k) => present.includes(k));
    const line = `${" ".repeat(indent)}${renderKey(key)}${renderValueAfterKey(
      newObj[key],
      indent,
      path.concat(key),
    )}\n`;

    if (after) {
      const pair = pairFor(map, after)!;
      const at = blockStart(ctx, pair.key as unknown);
      push(ctx, { start: at, end: at, text: line, order: ctx.seq++ });
    } else {
      const at = pairEnd(ctx, lastPair);
      push(ctx, { start: at, end: at, text: line, order: ctx.seq++ });
    }
    record(ctx, path.concat(key), "add");
  }
}

function diffSeq(
  ctx: Ctx,
  seq: YAMLSeq,
  oldArr: Json[],
  newArr: Json[],
  path: (string | number)[],
): void {
  if (seq.flow) {
    // Scalar-for-scalar edits inside a flow sequence still splice precisely;
    // anything structural re-renders the one-line collection.
    if (oldArr.length === newArr.length) {
      let structural = false;
      for (let i = 0; i < oldArr.length; i++) {
        if (!isScalarValue(oldArr[i]) || !isScalarValue(newArr[i])) {
          structural = true;
          break;
        }
      }
      if (!structural) {
        for (let i = 0; i < oldArr.length; i++) {
          if (deepEqual(oldArr[i], newArr[i])) continue;
          diffNode(ctx, seq.items[i], oldArr[i], newArr[i], path.concat(i));
        }
        return;
      }
    }
    replaceNode(ctx, seq, newArr, path, "replace", true);
    return;
  }

  if (seq.items.length !== oldArr.length)
    throw new Bail("sequence length drift");

  const pairing = pairItems(oldArr, newArr);
  const stable = new Set(stableIndices(pairing));
  const spaced = seqUsesBlankLines(seq);
  const indent = lineIndentOf(
    ctx.text,
    markerStart(ctx, seq.items[0] as unknown),
  );

  // Removals: old items nothing in the new array claims.
  const claimed = new Set(pairing.filter((p) => p !== null) as number[]);
  for (let i = 0; i < oldArr.length; i++) {
    if (claimed.has(i)) continue;
    cutItem(ctx, seq, i, path.concat(i), "remove");
  }

  // Moves: a paired item whose relative order changed is cut and re-inserted
  // with its original text, so its comments travel with it.
  for (let n = 0; n < newArr.length; n++) {
    const from = pairing[n];
    if (from === null || stable.has(n)) continue;
    const block = itemText(ctx, seq, from);
    cutItem(ctx, seq, from, path.concat(from), "move");
    const { at, atEnd } = insertPoint(ctx, seq, pairing, stable, n);
    // Moving to the end: the block brought its trailing blank line with it, but
    // the end of a list has none, so swap it for a leading one.
    const text =
      atEnd && spaced && block.endsWith("\n\n")
        ? `\n${block.slice(0, -1)}`
        : block;
    push(ctx, { start: at, end: at, text, order: ctx.seq++ });
  }

  // Additions. A list whose items are separated by blank lines keeps that
  // rhythm: an item inserted BEFORE another carries the blank after it, while
  // one appended past the last item carries the blank before it — the last item
  // in a list has no trailing blank to inherit.
  for (let n = 0; n < newArr.length; n++) {
    if (pairing[n] !== null) continue;
    const body = renderValue(newArr[n], indent + 2, path.concat(n));
    const { at, atEnd } = insertPoint(ctx, seq, pairing, stable, n);
    const item = `${" ".repeat(indent)}- ${body}\n`;
    const block = spaced ? (atEnd ? `\n${item}` : `${item}\n`) : item;
    push(ctx, { start: at, end: at, text: block, order: ctx.seq++ });
    record(ctx, path.concat(n), "add");
  }

  // Edits within items that stayed put.
  for (let n = 0; n < newArr.length; n++) {
    const from = pairing[n];
    if (from === null) continue;
    if (deepEqual(oldArr[from], newArr[n])) continue;
    try {
      diffNode(
        ctx,
        seq.items[from],
        oldArr[from],
        newArr[n],
        path.concat(from),
      );
    } catch (e) {
      if (!(e instanceof Bail)) throw e;
      replaceNode(
        ctx,
        seq.items[from],
        newArr[n],
        path.concat(from),
        "replace",
      );
    }
  }
}

/** Where to insert the new item at index `n`: before the next item that stays. */
function insertPoint(
  ctx: Ctx,
  seq: YAMLSeq,
  pairing: (number | null)[],
  stable: Set<number>,
  n: number,
): { at: number; atEnd: boolean } {
  for (let k = n + 1; k < pairing.length; k++) {
    const from = pairing[k];
    if (from !== null && stable.has(k)) {
      return { at: blockStart(ctx, seq.items[from] as unknown), atEnd: false };
    }
  }
  // Nothing after it stays put: land just past the last item, before whatever
  // trailing blank line or comment closes out the list.
  const last = seq.items[seq.items.length - 1] as unknown;
  return { at: blockEnd(ctx, last, false), atEnd: true };
}

function cutItem(
  ctx: Ctx,
  seq: YAMLSeq,
  index: number,
  path: (string | number)[],
  kind: PatchChange["kind"],
): void {
  const node = seq.items[index] as unknown;
  push(ctx, {
    start: blockStart(ctx, node),
    end: blockEnd(ctx, node, true),
    text: "",
    order: REPLACE_ORDER,
  });
  record(ctx, path, kind);
}

/**
 * itemText is the exact source of a sequence item — its comments, its blank
 * line, byte for byte. A move re-inserts this, which is why a reordered
 * scenario keeps its formatting instead of being re-rendered.
 */
function itemText(ctx: Ctx, seq: YAMLSeq, index: number): string {
  const node = seq.items[index] as unknown;
  return ctx.text.slice(blockStart(ctx, node), blockEnd(ctx, node, true));
}

// ── Scalar and whole-node replacement ────────────────────────────────────────

function replaceScalar(
  ctx: Ctx,
  node: Scalar,
  value: Json,
  path: (string | number)[],
): void {
  const [start, end] = node.range!;
  const indent = lineIndentOf(ctx.text, start);
  replaceRange(
    ctx,
    start,
    end,
    renderScalar(value, node, indent, path),
    path,
    "set",
  );
}

function replaceNode(
  ctx: Ctx,
  node: unknown,
  value: Json,
  path: (string | number)[],
  kind: PatchChange["kind"],
  forceFlow = false,
): void {
  const range = rangeOf(node);
  if (!range) throw new Bail("node has no range");
  const indent = lineIndentOf(ctx.text, range[0]);

  if (forceFlow && !isScalarValue(value)) {
    replaceRange(ctx, range[0], range[1], renderFlow(value, path), path, kind);
    return;
  }

  // A node that starts its own line (a block collection under a key, or a
  // sequence item's contents) is re-rendered in place at that indentation.
  if (startsOwnLine(ctx.text, range[0])) {
    replaceRange(
      ctx,
      range[0],
      range[1],
      renderValue(value, indent, path),
      path,
      kind,
    );
    return;
  }

  // A sequence item's contents follow the `- ` marker on the same line, with
  // any further lines aligned under them — never pushed onto a new line.
  if (isSeqItem(ctx.text, range[0])) {
    replaceRange(
      ctx,
      range[0],
      range[1],
      renderValue(value, indent + 2, path),
      path,
      kind,
    );
    return;
  }

  // Otherwise it sits after `key: `. Scalars and flow collections stay on that
  // line; a block collection moves to the lines below, which means swallowing
  // the space after the colon as well as the old value.
  const withKey = renderValueAfterKey(value, indent, path);
  const inline = withKey.slice(1); // drop the colon; only the value is replaced
  const block = inline.startsWith("\n");
  let start = range[0];
  if (block) while (start > 0 && /[ \t]/.test(ctx.text[start - 1])) start--;
  replaceRange(
    ctx,
    start,
    block ? extendToLineEnd(ctx.text, range[1]) - 1 : range[1],
    block ? inline : inline.replace(/^ /, ""),
    path,
    kind,
  );
}

/** Rewrite `key: <value>` wholesale — used when the value had no node. */
function replacePairValue(
  ctx: Ctx,
  pair: Pair,
  value: Json,
  path: (string | number)[],
): void {
  const key = pair.key as Scalar;
  const start = key.range![0];
  const end = pairEnd(ctx, pair);
  const indent = lineIndentOf(ctx.text, start);
  const text = `${renderKey(String(key.value))}${renderValueAfterKey(
    value,
    indent,
    path,
  )}\n`;
  push(ctx, { start, end, text, order: REPLACE_ORDER });
  record(ctx, path, "replace");
}

// ── Rendering ────────────────────────────────────────────────────────────────

/**
 * Keys whose string values are prose — command output, log lines, file bodies,
 * labels — and are therefore always quoted, the way the lab files write them.
 * Everything else (`delay: pull`, `command: [docker, run]`, `conclusion:
 * failure`, an `id`) is left plain when plain is safe.
 */
const PROSE_KEYS = new Set([
  "commit",
  "content",
  "description",
  "error",
  "find",
  "intro",
  "label",
  "logs",
  "outro",
  "output",
  "prompt",
  "result",
  "stderr",
  "summary",
  "text",
  "title",
  "with",
]);

/** isProse reports whether the value at `path` is prose (see PROSE_KEYS). */
function isProse(path: (string | number)[]): boolean {
  for (let i = path.length - 1; i >= 0; i--) {
    const seg = path[i];
    if (typeof seg === "string") return PROSE_KEYS.has(seg);
  }
  return false;
}

/**
 * renderValueAfterKey renders a value for the `key:` line — inline for scalars
 * and small flow collections, on following lines for block collections.
 */
function renderValueAfterKey(
  value: Json,
  keyIndent: number,
  path: (string | number)[],
): string {
  if (isScalarValue(value)) {
    const rendered = renderScalar(value, null, keyIndent, path);
    return rendered === "" ? ":" : `: ${rendered}`;
  }
  if (preferFlow(value, path) || isEmptyCollection(value)) {
    return `: ${renderFlow(value, path)}`;
  }
  return `:\n${" ".repeat(keyIndent + 2)}${renderValue(
    value,
    keyIndent + 2,
    path,
  )}`;
}

/** renderValue renders any value as a fragment whose first line is not indented. */
function renderValue(
  value: Json,
  indent: number,
  path: (string | number)[],
): string {
  if (isScalarValue(value)) return renderScalar(value, null, indent, path);
  if (preferFlow(value, path) || isEmptyCollection(value)) {
    return renderFlow(value, path);
  }
  return renderBlock(value, indent, path);
}

/**
 * renderBlock renders a collection in block style, recursing through
 * renderValue so every nested piece gets the same treatment — which is how a
 * generated block ends up indistinguishable from a hand-written one:
 * `command: [docker, run]`, `args: { --name: { any: true } }`, a block literal
 * where the string has newlines. The library is only used for scalars, where
 * quoting and block-scalar chomping are genuinely fiddly.
 *
 * The first line is NOT indented (it follows a `key:` or a `- `); every line
 * after it is indented by `indent`.
 */
function renderBlock(
  value: Json,
  indent: number,
  path: (string | number)[],
): string {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    return value
      .map(
        (item, i) =>
          `${i === 0 ? "" : pad}- ${renderValue(item, indent + 2, path.concat(i))}`,
      )
      .join("\n");
  }
  return Object.entries(value as Record<string, Json>)
    .map(
      ([key, item], i) =>
        `${i === 0 ? "" : pad}${renderKey(key)}${renderValueAfterKey(
          item,
          indent,
          path.concat(key),
        )}`,
    )
    .join("\n");
}

/**
 * renderFlow emits a one-line flow collection in the house style the lab files
 * use: `{ any: true }` (padded maps) and `[docker, run]` (unpadded sequences).
 * The library's single `flowCollectionPadding` option can't express both.
 */
function renderFlow(value: Json, path: (string | number)[]): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[${value
      .map((v, i) => renderFlowItem(v, path.concat(i)))
      .join(", ")}]`;
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    const body = entries
      .map(([k, v]) => `${renderKey(k)}: ${renderFlowItem(v, path.concat(k))}`)
      .join(", ");
    return `{ ${body} }`;
  }
  return renderScalar(value, null, 0, path);
}

function renderFlowItem(value: Json, path: (string | number)[]): string {
  if (isScalarValue(value)) return renderScalar(value, null, 0, path);
  return renderFlow(value, path);
}

/**
 * renderScalar renders one scalar. It keeps the style of the node it replaces
 * when that style can still represent the value, so editing a quoted line
 * leaves it quoted and editing a plain one leaves it plain. New strings follow
 * the lab files: prose is quoted, identifiers stay plain, multi-line content
 * becomes a block literal, and a string carrying double quotes takes single
 * ones rather than a line full of backslashes.
 */
function renderScalar(
  value: Json,
  old: Scalar | null,
  indent: number,
  path: (string | number)[],
): string {
  if (typeof value !== "string") {
    // `null` renders empty so `key:` stays bare rather than becoming `key: null`.
    if (value === null) return "";
    return String(value);
  }

  if (value.includes("\n")) return renderBlockScalar(value, indent);

  const type = scalarType(value, old, path);
  return stringify(scalarWithType(value, type), {
    lineWidth: 0,
    singleQuote: type === Scalar.QUOTE_SINGLE,
  }).replace(/\n$/, "");
}

function scalarType(
  value: string,
  old: Scalar | null,
  path: (string | number)[],
): string {
  const wantsSingle = value.includes('"') && !value.includes("'");
  const inherited = old && !isBlockType(old.type) ? old.type : undefined;
  // A double-quoted style is worth overriding for a value full of quotes.
  if (wantsSingle && inherited !== Scalar.PLAIN) return Scalar.QUOTE_SINGLE;
  if (inherited) return inherited;
  if (!isProse(path) && isPlainSafe(value)) return Scalar.PLAIN;
  return wantsSingle ? Scalar.QUOTE_SINGLE : Scalar.QUOTE_DOUBLE;
}

/**
 * isPlainSafe reports whether a string can be written without quotes anywhere
 * (block or flow context) and read back as the same string. Deliberately
 * conservative: anything with an indicator character, a leading or trailing
 * space, or a resolvable non-string meaning gets quoted.
 */
function isPlainSafe(value: string): boolean {
  if (value === "" || value !== value.trim()) return false;
  if (/[:#,[\]{}&*!|>'"%@`\\\n]/.test(value)) return false;
  if (/^[-?]/.test(value)) return false;
  if (/^[0-9.+-]/.test(value) && !Number.isNaN(Number(value))) return false;
  if (/^(true|false|null|~|yes|no|on|off)$/i.test(value)) return false;
  return true;
}

/**
 * renderBlockScalar renders a multi-line string as a block literal, indented to
 * sit at `indent` (the indentation of the line it starts on — the key's line or
 * the `- ` marker's).
 *
 * It stringifies the scalar UNDER A KEY and slices the value back out, because
 * the library only gets chomping (`|`, `|-`, `|+`) and the indentation
 * indicator (`|2`, needed when the first line starts with a space) right when
 * the scalar has a parent to be relative to. Stringifying it alone silently
 * emits content at column 0, which splices into unparseable YAML.
 */
function renderBlockScalar(value: string, indent: number): string {
  const doc = new Document({ k: scalarWithType(value, Scalar.BLOCK_LITERAL) });
  const out = doc.toString({
    lineWidth: 0,
    indent: 2,
    blockQuote: "literal",
  });
  const body = out.slice(out.indexOf("k: ") + 3).replace(/\n$/, "");
  return indentRest(body, indent);
}

function scalarWithType(value: string, type: string | undefined): Scalar {
  const s = new Scalar(value);
  if (type) s.type = type as Scalar.Type;
  return s;
}

function isBlockType(type: unknown): boolean {
  return type === Scalar.BLOCK_LITERAL || type === Scalar.BLOCK_FOLDED;
}

/**
 * preferFlow decides whether a collection reads better on one line. The rules
 * are read off the lab files rather than invented, so generated content sits
 * beside hand-written content without looking out of place:
 *
 *   - a sequence goes flow only when every item is a scalar
 *        command: [docker, run]        oneOf: ["localhost:8080", "…"]
 *   - a mapping goes flow when every value is a scalar, or when it has a
 *     single entry whose value is itself flow-able
 *        { text: "…", delay: beat }    args: { --name: { any: true } }
 *   - a mapping of two or more dot-path keys stays block, because that is a
 *     list of state effects rather than one compact condition
 *        state:
 *          container.created: true
 *          container.running: true
 *   - and nothing goes flow if the line would run long
 */
function preferFlow(value: Json, path: (string | number)[] = []): boolean {
  const key = [...path].reverse().find((p) => typeof p === "string");
  if (typeof key === "string" && BLOCK_KEYS.has(key)) return false;
  if (Array.isArray(value)) {
    if (value.length === 0) return false;
    if (!value.every((v) => isFlowScalar(v))) return false;
    return fitsOneLine(value);
  }
  if (!isPlainObject(value)) return false;

  const entries = Object.entries(value);
  if (entries.length === 0) return false;
  if (entries.length > 4) return false;
  if (entries.length > 1 && entries.some(([k]) => k.includes(".")))
    return false;

  const allScalar = entries.every(([, v]) => isFlowScalar(v));
  const singleNested =
    entries.length === 1 &&
    preferFlow(entries[0][1], path.concat(entries[0][0]));
  if (!allScalar && !singleNested) return false;
  return fitsOneLine(value);
}

/**
 * Keys the format treats as structural blocks. The sample labs and the spec
 * always write these open, however short they happen to be, so a generated
 * scenario reads like the ones around it rather than collapsing into
 * `when: { command: docker ps }`.
 */
const BLOCK_KEYS = new Set([
  "defaults",
  "input",
  "metadata",
  "scenarios",
  "session",
  "settings",
  "then",
  "when",
  "workflows",
]);

function isFlowScalar(v: Json): boolean {
  return isScalarValue(v) && !(typeof v === "string" && v.includes("\n"));
}

function fitsOneLine(value: Json): boolean {
  return renderFlow(value, []).length <= 100;
}

function isEmptyCollection(value: Json): boolean {
  return (
    (Array.isArray(value) && value.length === 0) ||
    (isPlainObject(value) && Object.keys(value).length === 0)
  );
}

/**
 * isPlainKey reports whether a mapping key needs no quotes — including the
 * flag-shaped keys an arg matcher uses (`--name`, `-d`), which the library
 * would quote because they start with a dash.
 */
function isPlainKey(key: string): boolean {
  if (/^\d+$/.test(key)) return true;
  if (/^[A-Za-z0-9_][A-Za-z0-9_./+=-]*$/.test(key)) return true;
  return /^-{1,2}[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(key);
}

/** renderKey renders a mapping key, keeping positional arg indices numeric. */
function renderKey(key: string): string {
  if (isPlainKey(key)) return key;
  return stringify(key, { lineWidth: 0 }).replace(/\n$/, "");
}

function indentRest(text: string, indent: number): string {
  if (indent <= 0 || !text.includes("\n")) return text;
  const pad = " ".repeat(indent);
  return text
    .split("\n")
    .map((line, i) => (i === 0 || line === "" ? line : pad + line))
    .join("\n");
}

// ── Sequence pairing (identity-aware diff) ───────────────────────────────────

/**
 * pairItems matches new items to old ones so a reorder or an insertion doesn't
 * read as "everything after this point changed". Objects carrying an `id` match
 * by id (scenarios, workflows, controls, steps); everything else matches by
 * value, greedily and in order.
 */
function pairItems(oldArr: Json[], newArr: Json[]): (number | null)[] {
  const used = new Set<number>();
  const pairing: (number | null)[] = newArr.map(() => null);

  const idOf = (v: Json): string | null =>
    isPlainObject(v) && typeof v.id === "string" ? v.id : null;

  // Pass 1: by id.
  for (let n = 0; n < newArr.length; n++) {
    const id = idOf(newArr[n]);
    if (id === null) continue;
    for (let o = 0; o < oldArr.length; o++) {
      if (used.has(o) || idOf(oldArr[o]) !== id) continue;
      pairing[n] = o;
      used.add(o);
      break;
    }
  }

  // Pass 2: by exact value, nearest first, so identical output lines pair up
  // with the copy closest to where they now sit.
  for (let n = 0; n < newArr.length; n++) {
    if (pairing[n] !== null || idOf(newArr[n]) !== null) continue;
    let best = -1;
    let bestDist = Infinity;
    for (let o = 0; o < oldArr.length; o++) {
      if (used.has(o) || !deepEqual(oldArr[o], newArr[n])) continue;
      const dist = Math.abs(o - n);
      if (dist < bestDist) {
        best = o;
        bestDist = dist;
      }
    }
    if (best >= 0) {
      pairing[n] = best;
      used.add(best);
    }
  }

  // Pass 3: leftovers pair positionally, whatever their shape. Turning an
  // output line into a paced `{ text, delay }` entry is an EDIT of that line,
  // not a delete plus an insert — and the two read very differently in a diff.
  const freeNew = pairing
    .map((p, n) => (p === null ? n : -1))
    .filter((n) => n >= 0);
  const freeOld = oldArr
    .map((_, o) => (used.has(o) ? -1 : o))
    .filter((o) => o >= 0);
  for (let i = 0; i < Math.min(freeNew.length, freeOld.length); i++) {
    pairing[freeNew[i]] = freeOld[i];
    used.add(freeOld[i]);
  }
  return pairing;
}

/**
 * stableIndices returns the new-array positions that don't need to move: the
 * longest run of paired items whose old indices are already increasing.
 */
function stableIndices(pairing: (number | null)[]): number[] {
  const pts: { n: number; o: number }[] = [];
  pairing.forEach((o, n) => {
    if (o !== null) pts.push({ n, o });
  });
  // Longest increasing subsequence over old indices (O(n²) is plenty here).
  const best: number[] = pts.map(() => 1);
  const prev: number[] = pts.map(() => -1);
  let endAt = -1;
  let endLen = 0;
  for (let i = 0; i < pts.length; i++) {
    for (let j = 0; j < i; j++) {
      if (pts[j].o < pts[i].o && best[j] + 1 > best[i]) {
        best[i] = best[j] + 1;
        prev[i] = j;
      }
    }
    if (best[i] > endLen) {
      endLen = best[i];
      endAt = i;
    }
  }
  const out: number[] = [];
  for (let i = endAt; i >= 0; i = prev[i]) out.push(pts[i].n);
  return out.reverse();
}

// ── Source-range helpers ─────────────────────────────────────────────────────

function rangeOf(node: unknown): [number, number, number] | null {
  const r = (node as { range?: [number, number, number] }).range;
  return r ?? null;
}

function pairFor(map: YAMLMap, key: string): Pair | undefined {
  // String comparison on purpose: `doc.toJS()` stringifies keys, so a
  // positional arg matcher parsed as the number 0 arrives as "0". The
  // library's own findPair compares strictly and would silently add a
  // duplicate key.
  for (const item of map.items) {
    if (!isPair(item)) continue;
    const k = item.key;
    const value = isScalar(k) ? k.value : k;
    if (String(value) === key) return item as Pair;
  }
  return undefined;
}

function mapKeys(map: YAMLMap): string[] {
  return map.items
    .filter((i) => isPair(i))
    .map((i) => {
      const k = (i as Pair).key;
      return String(isScalar(k) ? k.value : k);
    });
}

/** lineStartOf returns the offset of the first character of pos's line. */
function lineStartOf(text: string, pos: number): number {
  const nl = text.lastIndexOf("\n", Math.max(0, pos - 1));
  return nl === -1 ? 0 : nl + 1;
}

function lineIndentOf(text: string, pos: number): number {
  const start = lineStartOf(text, pos);
  let i = start;
  while (i < text.length && text[i] === " ") i++;
  return i - start;
}

function startsOwnLine(text: string, pos: number): boolean {
  return /^\s*$/.test(text.slice(lineStartOf(text, pos), pos));
}

/** isSeqItem reports whether pos is the start of a `- ` sequence item's value. */
function isSeqItem(text: string, pos: number): boolean {
  return /^[ \t]*-[ \t]+$/.test(text.slice(lineStartOf(text, pos), pos));
}

/** extendToLineEnd returns the offset just past the newline at/after pos. */
function extendToLineEnd(text: string, pos: number): number {
  if (pos > 0 && text[pos - 1] === "\n") return pos;
  const nl = text.indexOf("\n", pos);
  return nl === -1 ? text.length : nl + 1;
}

/**
 * markerStart returns the offset of a sequence item's `- ` marker, or the
 * node's own start when it isn't a sequence item: a block mapping used as a
 * sequence item begins at its first key, past the dash.
 */
function markerStart(ctx: Ctx, node: unknown): number {
  const range = rangeOf(node);
  if (!range) throw new Bail("node has no range");
  const start = lineStartOf(ctx.text, range[0]);
  const before = ctx.text.slice(start, range[0]);
  const m = before.match(/^([ \t]*)-[ \t]+$/);
  return m ? start + m[1].length : range[0];
}

/**
 * blockStart returns where a node's block begins in the source: the start of
 * its line, plus any comment lines written DIRECTLY above it.
 *
 * "Directly" is the whole rule, and it matches the convention the lab files
 * already follow. A comment touching the item documents that item and travels
 * with it:
 *
 *     # A rebuild AFTER the fix produces a patched image.
 *     - id: docker-build-patched
 *
 * A comment separated by a blank line is a section banner for everything that
 * follows, and stays where the author put it:
 *
 *     # ══ SECTION 2 — Docker Scout ══
 *
 *     - id: docker-build-patched
 *
 * Reading it off the text rather than off `commentBefore` is deliberate: the
 * parser hands a leading comment to the enclosing collection rather than to the
 * first item, so the first scenario in a list would otherwise lose its note.
 */
function blockStart(ctx: Ctx, node: unknown): number {
  let start = lineStartOf(ctx.text, markerStart(ctx, node));
  while (start > 0) {
    const prev = lineStartOf(ctx.text, start - 1);
    if (!/^[ \t]*#/.test(ctx.text.slice(prev, start))) break;
    start = prev;
  }
  return start;
}

/**
 * blockEnd returns where a node's block ends: past the end of its last line
 * and, when `blank` is set, past the blank lines that follow it. A sequence
 * item owns the blank line under it, so cutting or moving one keeps the
 * one-blank-line-between-scenarios rhythm the lab files use.
 */
function blockEnd(ctx: Ctx, node: unknown, blank: boolean): number {
  const range = rangeOf(node);
  if (!range) throw new Bail("node has no range");
  let end = extendToLineEnd(ctx.text, Math.max(range[1], range[2]));
  if (blank) {
    while (end < ctx.text.length) {
      const next = extendToLineEnd(ctx.text, end + 1);
      if (!/^[ \t]*\n$/.test(ctx.text.slice(end, next))) break;
      end = next;
    }
  }
  return end;
}

function pairEnd(ctx: Ctx, pair: Pair): number {
  const key = pair.key as Scalar;
  const value = pair.value as { range?: [number, number, number] } | null;
  const end = value?.range
    ? Math.max(value.range[1], value.range[2])
    : Math.max(key.range![1], key.range![2]);
  return extendToLineEnd(ctx.text, end);
}

function seqUsesBlankLines(seq: YAMLSeq): boolean {
  for (const item of seq.items) {
    if ((item as { spaceBefore?: boolean })?.spaceBefore) return true;
  }
  return false;
}

// ── Splice application ───────────────────────────────────────────────────────

function push(ctx: Ctx, splice: Splice): void {
  ctx.splices.push(splice);
}

/**
 * replaceRange swaps a source range for rendered text, keeping the line break
 * the old text ended with. Block scalars and block collections include their
 * final newline in `range[1]`, unlike quoted and plain scalars — dropping it
 * would glue the next key onto the end of the value.
 */
function replaceRange(
  ctx: Ctx,
  start: number,
  end: number,
  text: string,
  path: (string | number)[],
  kind: PatchChange["kind"],
): void {
  const ended = end > start && ctx.text[end - 1] === "\n";
  push(ctx, {
    start,
    end,
    text: ended && !text.endsWith("\n") ? `${text}\n` : text,
    order: REPLACE_ORDER,
  });
  record(ctx, path, kind);
}

function record(
  ctx: Ctx,
  path: (string | number)[],
  kind: PatchChange["kind"],
  note?: string,
): void {
  ctx.changes.push({ path: formatPath(path), kind, note });
}

export function formatPath(path: (string | number)[]): string {
  return path
    .map((p, i) =>
      typeof p === "number" ? `[${p}]` : i === 0 ? String(p) : `.${p}`,
    )
    .join("");
}

/**
 * applySplices rewrites the text from the end backwards. Overlapping edits mean
 * the diff walk produced something it can't express positionally, so it bails
 * to the rebuild path rather than writing a mangled file.
 */
function applySplices(text: string, splices: Splice[]): string {
  const sorted = [...splices].sort((a, b) =>
    a.start !== b.start ? a.start - b.start : a.order - b.order,
  );
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const next = sorted[i];
    if (next.start < prev.end && prev.start !== prev.end) {
      throw new Bail(
        `overlapping edits at ${next.start} (previous ends ${prev.end})`,
      );
    }
  }
  let out = text;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const s = sorted[i];
    out = out.slice(0, s.start) + s.text + out.slice(s.end);
  }
  return out;
}

// ── Fallback: mutate the Document ────────────────────────────────────────────

/**
 * rebuild applies the model to the parsed document node by node and
 * re-serializes. Comments on surviving nodes are kept; whitespace and flow
 * styling elsewhere are normalized, which is why this is the fallback and not
 * the default.
 */
function rebuild(text: string, model: Json): string {
  const doc = parseDocument(text);
  doc.contents = applyToNode(doc, doc.contents as unknown, model) as never;
  return doc.toString({ lineWidth: 0, blockQuote: "literal" });
}

function applyToNode(doc: Document, node: unknown, value: Json): unknown {
  if (isScalar(node) && isScalarValue(value)) {
    node.value = value;
    if (typeof value === "string" && value.includes("\n")) {
      node.type = Scalar.BLOCK_LITERAL;
    } else if (isBlockType(node.type)) {
      node.type = Scalar.QUOTE_DOUBLE;
    }
    return node;
  }
  if (isMap(node) && isPlainObject(value)) {
    const keys = Object.keys(value);
    // Drop removed keys, update survivors, append additions — in model order.
    const kept: Pair[] = [];
    for (const key of keys) {
      const existing = pairFor(node, key);
      if (existing) {
        existing.value = applyToNode(doc, existing.value, value[key]) as never;
        kept.push(existing);
      } else {
        kept.push(
          new Pair(doc.createNode(numericKey(key)), doc.createNode(value[key])),
        );
      }
    }
    node.items = kept as never[];
    return node;
  }
  if (isSeq(node) && Array.isArray(value)) {
    const oldArr = (node.toJSON() as Json[]) ?? [];
    const pairing = pairItems(oldArr, value);
    node.items = value.map((v, n) => {
      const from = pairing[n];
      if (from !== null && node.items[from] !== undefined) {
        return applyToNode(doc, node.items[from], v);
      }
      return doc.createNode(v);
    }) as never[];
    return node;
  }
  return doc.createNode(value);
}

function numericKey(key: string): string | number {
  return /^\d+$/.test(key) ? Number(key) : key;
}

// ── Value helpers ────────────────────────────────────────────────────────────

export function isPlainObject(v: unknown): v is Record<string, Json> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isScalarValue(v: Json): v is null | boolean | number | string {
  return v === null || typeof v !== "object";
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ak = Object.keys(a as object);
    const bk = Object.keys(b as object);
    if (ak.length !== bk.length) return false;
    return ak.every(
      (k) =>
        Object.prototype.hasOwnProperty.call(b, k) &&
        deepEqual(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
        ),
    );
  }
  return false;
}
