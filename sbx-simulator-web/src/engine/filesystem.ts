// An in-memory virtual filesystem for a lab's `then.files` effects, ported from
// the Go filesystem package but backed by a Map instead of the host disk.
//
// The web simulator never touches real files — but file ops are still part of
// the deterministic state machine (e.g. a `replace` whose `find` is missing is
// a hard error that fails the lab). Modelling them faithfully keeps web and CLI
// behavior identical. Host commands (ls, cat, …) are intentionally NOT mocked.
// See sbx-simulator/docs/scenario-spec.md §7.1.

export class FSError extends Error {}

export class FS {
  /** path -> file contents. Directories are implied by file paths plus `dirs`. */
  private files = new Map<string, string>();
  private dirs = new Set<string>();

  /**
   * @param seed initial files keyed by lab-relative path (e.g. "app/server.js").
   */
  constructor(seed: Record<string, string> = {}) {
    for (const [path, content] of Object.entries(seed)) {
      const clean = this.resolve(path);
      this.files.set(clean, content);
      this.markParents(clean);
    }
  }

  /** list returns every file path currently present, sorted, for inspection. */
  list(): string[] {
    return [...this.files.keys()].sort();
  }

  /** read returns a file's contents, or undefined if absent. */
  read(path: string): string | undefined {
    return this.files.get(this.resolve(path));
  }

  /** snapshot returns a copy of all files keyed by path. */
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.files);
  }

  mkdir(path: string): void {
    const clean = this.resolve(path);
    this.dirs.add(clean);
    this.markParents(clean);
  }

  create(path: string, content: string): void {
    const clean = this.resolve(path);
    this.files.set(clean, content);
    this.markParents(clean);
  }

  append(path: string, content: string): void {
    const clean = this.resolve(path);
    this.files.set(clean, (this.files.get(clean) ?? "") + content);
    this.markParents(clean);
  }

  /**
   * replace substitutes every occurrence of find with `with` in a file. It
   * throws if the file is missing or find does not occur, so authoring mistakes
   * fail fast rather than silently no-op'ing (matches the Go behavior).
   */
  replace(path: string, find: string, replacement: string): void {
    if (!find) {
      throw new FSError(`replace on "${path}" requires a non-empty \`find\``);
    }
    const clean = this.resolve(path);
    const raw = this.files.get(clean);
    if (raw === undefined) {
      throw new FSError(`replace "${path}": no such file`);
    }
    if (!raw.includes(find)) {
      throw new FSError(`replace "${path}": text not found: "${find}"`);
    }
    this.files.set(clean, raw.split(find).join(replacement));
  }

  /** delete removes a file or a directory subtree. Missing paths are not errors. */
  delete(path: string): void {
    const clean = this.resolve(path);
    this.files.delete(clean);
    this.dirs.delete(clean);
    const prefix = clean + "/";
    for (const p of [...this.files.keys()]) {
      if (p.startsWith(prefix)) this.files.delete(p);
    }
    for (const d of [...this.dirs]) {
      if (d.startsWith(prefix)) this.dirs.delete(d);
    }
  }

  copy(src: string, dst: string): void {
    const from = this.resolve(src);
    const raw = this.files.get(from);
    if (raw === undefined) {
      throw new FSError(`copy "${src}": no such file`);
    }
    const to = this.resolve(dst);
    this.files.set(to, raw);
    this.markParents(to);
  }

  private markParents(path: string): void {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      this.dirs.add(parts.slice(0, i).join("/"));
    }
  }

  /**
   * resolve validates and normalizes a lab-relative path. Absolute paths and
   * any path escaping the lab root (via "../") are rejected.
   */
  private resolve(p: string): string {
    if (!p) {
      throw new FSError("empty path");
    }
    if (p.startsWith("/")) {
      throw new FSError(`absolute paths are not allowed: "${p}"`);
    }
    const out: string[] = [];
    for (const seg of p.split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") {
        if (out.length === 0) {
          throw new FSError(`path escapes lab root: "${p}"`);
        }
        out.pop();
        continue;
      }
      out.push(seg);
    }
    if (out.length === 0) {
      throw new FSError(`path escapes lab root: "${p}"`);
    }
    return out.join("/");
  }
}
