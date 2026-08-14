// Builds a workspace package for publishing: JSX/TS -> ESM JavaScript, SCSS ->
// CSS, assets copied, import specifiers rewritten to match.
//
//   node scripts/build-package.mjs packages/labspace
//
// WHY A BUILD EXISTS AT ALL
//
// Both packages used to ship source — `.jsx` and `.scss` for the runtime, `.ts`
// for the simulator — and let the consumer's bundler deal with it. That works
// inside this repo, where the packages sit under the app's Vite root, and it made
// integrating anywhere else a slog. A host had to:
//
//   - set `ssr.noExternal` for both packages, because Vite externalises
//     node_modules for the server build and Node cannot execute JSX; and
//   - grow an `optimizeDeps.include` list covering every CommonJS package in the
//     transitive tree, discovered one browser error at a time, because Vite never
//     crawled the un-optimised source package to find them.
//
// Neither is the consumer's problem to solve. A published package ships built
// output; then the entire integration is whatever React plugin the host already
// uses. That is the whole point of this script.
//
// WHY TRANSPILE IN PLACE, RATHER THAN BUNDLE
//
// `dist/` mirrors `src/` file for file. Bundling to a single module would inline
// the CSS side-effect imports and flatten the module graph, which costs a
// consumer tree-shaking and makes `./loader` (the React-free entry) impossible to
// keep genuinely React-free. Transpiling preserves both, and keeps
// `import "./Foo.css"` in the output so a consumer's bundler handles styles the
// ordinary way — no "remember to import the stylesheet" step.

import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import * as sass from "sass";
import { build as esbuild } from "esbuild";

const pkgDir = resolve(process.argv[2] ?? ".");
const srcDir = join(pkgDir, "src");
const outDir = join(pkgDir, "dist");
const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));

/** Every file under a directory, recursively. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

rmSync(outDir, { recursive: true, force: true });

const files = walk(srcDir).filter(
  // Tests and their fixtures are not part of the published surface.
  (f) => !/\.test\.[jt]sx?$/.test(f),
);

const code = files.filter((f) => /\.(js|jsx|ts|tsx)$/.test(f));
const styles = files.filter((f) => f.endsWith(".scss"));
const plainCss = files.filter((f) => f.endsWith(".css"));
const assets = files.filter(
  (f) => !/\.(js|jsx|ts|tsx|scss|css)$/.test(extname(f) ? f : `${f}.x`),
);

// ── JavaScript ─────────────────────────────────────────────────────────────
// One output file per input, ESM, JSX transformed with the automatic runtime so
// the output never needs React in scope.
await esbuild({
  entryPoints: code,
  outdir: outDir,
  outbase: srcDir,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  jsx: "automatic",
  sourcemap: true,
  // Every import stays external: this transpiles, it does not bundle.
  packages: "external",
  logLevel: "warning",
});

// Source imports name the file they were written against — `./Foo.jsx`,
// `./Foo.scss` — and esbuild leaves specifiers alone. After compiling, those
// files are `./Foo.js` and `./Foo.css`, so the specifiers have to follow. (This
// is why the extensions are explicit in the source at all: a consumer's bundler
// won't guess them for a file inside node_modules.)
const REWRITES = [
  [/(["'])(\.[^"']*)\.(?:jsx|tsx|ts)\1/g, "$1$2.js$1"],
  [/(["'])(\.[^"']*)\.scss\1/g, "$1$2.css$1"],
];
for (const file of walk(outDir).filter((f) => f.endsWith(".js"))) {
  const src = readFileSync(file, "utf8");
  let out = src;
  for (const [pattern, replacement] of REWRITES) {
    out = out.replace(pattern, replacement);
  }

  // Node's ESM loader does not guess extensions, and a bundler only does so for
  // project source — not for a dependency in node_modules. TypeScript's `bundler`
  // resolution lets the source write `./engine/index`, so completing those here
  // means neither package has to encode this in how it is written.
  out = out.replace(
    /(from\s*|import\s*\(\s*)(["'])(\.[^"']*)\2/g,
    (whole, prefix, quote, spec) => {
      if (/\.(js|css|json|woff2?)$/.test(spec)) return whole;
      const target = resolve(dirname(file), spec);
      for (const candidate of [`${target}.js`, join(target, "index.js")]) {
        if (existsSync(candidate)) {
          const rel = relative(dirname(file), candidate).split(sep).join("/");
          return `${prefix}${quote}${rel.startsWith(".") ? rel : `./${rel}`}${quote}`;
        }
      }
      throw new Error(
        `${relative(pkgDir, file)}: cannot resolve "${spec}" in the build output`,
      );
    },
  );

  if (out !== src) writeFileSync(file, out);
}

// ── Styles ─────────────────────────────────────────────────────────────────
// Compiled individually so each stays beside the component that imports it, and
// so a consumer only pays for the components it uses.
for (const file of styles) {
  const target = join(outDir, relative(srcDir, file)).replace(
    /\.scss$/,
    ".css",
  );
  const result = sass.compile(file, {
    // A stylesheet may `@use` a package (rehype-github-alerts' alert styles).
    loadPaths: [
      join(pkgDir, "node_modules"),
      resolve(pkgDir, "../../node_modules"),
    ],
    style: "compressed",
    quietDeps: true,
  });
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, result.css);
}

for (const file of plainCss) {
  const target = join(outDir, relative(srcDir, file));
  mkdirSync(dirname(target), { recursive: true });
  cpSync(file, target);
}

// ── One stylesheet, and no CSS imports left in the JavaScript ───────────────
//
// The compiled modules must not `import "./Foo.css"`, however natural that looks.
// A server-side render imports the package through Node — Astro does exactly this
// for `client:load`, and Vite externalises node_modules for the SSR build — and
// Node cannot load a `.css` file:
//
//   Unknown file extension ".css" for .../dist/components/Labspace.css
//   Hint: You likely need to add this package to `vite.ssr.noExternal`
//
// Taking that hint would push bundler configuration onto every consumer, which is
// the thing this build exists to remove. So the CSS is concatenated into one
// `dist/styles.css` and the imports are stripped, which is what a published
// component library normally does: the consumer writes one ordinary import and
// needs no build config at all. Verified against a real Astro site.
const cssOrder = [];

// Third-party stylesheets the source imports by package name. They are not in
// dist/, so inline them — and first, so our own rules can override them.
for (const file of code) {
  const src = readFileSync(file, "utf8");
  for (const [, spec] of src.matchAll(
    /import\s+["']([^"'.][^"']*\.css)["']/g,
  )) {
    const resolved = import.meta.resolve(spec, `file://${file}`);
    cssOrder.push({
      css: readFileSync(fileURLToPath(resolved), "utf8"),
      dir: ".",
      from: spec,
    });
  }
}

// Then ours: the shared base (the icon font) ahead of the components that use it.
const emitted = walk(outDir).filter((f) => f.endsWith(".css"));
const rank = (f) => (f.includes(`${sep}styles${sep}`) ? 0 : 1);
for (const file of emitted.sort(
  (a, b) => rank(a) - rank(b) || a.localeCompare(b),
)) {
  const rel = relative(outDir, file);
  cssOrder.push({
    css: readFileSync(file, "utf8"),
    dir: dirname(rel),
    from: rel,
  });
}

// A relative `url()` resolves against the stylesheet holding it, so moving rules
// into a file at the dist root means rewriting each one to keep pointing at the
// same asset.
const bundled = cssOrder
  .map(({ css, dir, from }) => {
    const fixed =
      dir === "."
        ? css
        : css.replace(
            /url\(\s*(["']?)(?!data:|https?:|\/|#)([^"')]+)\1\s*\)/g,
            (_m, quote, url) =>
              `url(${quote}./${join(dir, url).split(sep).join("/")}${quote})`,
          );
    return `/* ${from} */\n${fixed}`;
  })
  .join("\n");
writeFileSync(join(outDir, "styles.css"), `${bundled}\n`);

for (const file of walk(outDir).filter((f) => f.endsWith(".js"))) {
  const src = readFileSync(file, "utf8");
  const out = src.replace(/^\s*import\s+["'][^"']+\.css["'];?\s*$/gm, "");
  if (out !== src) writeFileSync(file, out);
}

// ── Assets ─────────────────────────────────────────────────────────────────
// Fonts and images referenced by `url(...)` in the CSS above, which sass leaves
// as relative paths — so they have to land in the same shape under dist/.
for (const file of assets) {
  const target = join(outDir, relative(srcDir, file));
  mkdirSync(dirname(target), { recursive: true });
  cpSync(file, target);
}

// ── Types ──────────────────────────────────────────────────────────────────
// Only for a TypeScript package; the runtime is plain JSX and ships none.
const isTypeScript = code.some((f) => /\.tsx?$/.test(f));
if (isTypeScript) {
  execFileSync(
    "npx",
    [
      "tsc",
      "--emitDeclarationOnly",
      "--declaration",
      "--declarationMap",
      // The package's tsconfig sets `noEmit` because its everyday job is
      // typechecking; publishing is the one time we do want output.
      "--noEmit",
      "false",
      "--outDir",
      "dist",
      "--rootDir",
      "src",
    ],
    { cwd: pkgDir, stdio: "inherit" },
  );
}

// ── Check the output before anyone publishes it ─────────────────────────────
// Every bare specifier the build emits must be a declared dependency. Inside this
// monorepo an undeclared one still resolves, because npm hoists the APP's
// dependencies into a shared node_modules — so the package works here and
// installs broken everywhere else. That is exactly how nine of the runtime's
// dependencies (react-markdown, the remark/rehype chain, the syntax highlighter)
// came to be missing from its manifest.
const declared = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
  ...Object.keys(pkg.optionalDependencies ?? {}),
]);
const undeclared = new Set();
for (const file of walk(outDir).filter((f) => f.endsWith(".js"))) {
  const src = readFileSync(file, "utf8");
  const specifiers = src.matchAll(
    /(?:from\s*|import\s*\(\s*)["']([^"'.][^"']*)["']/g,
  );
  for (const [, spec] of specifiers) {
    if (spec.startsWith("node:")) continue;
    // Scoped packages carry the scope; everything else is the first segment.
    const name = spec.startsWith("@")
      ? spec.split("/").slice(0, 2).join("/")
      : spec.split("/")[0];
    if (!declared.has(name)) undeclared.add(name);
  }
}
if (undeclared.size) {
  console.error(
    `\n${pkg.name}: imports ${undeclared.size} package(s) it does not declare:`,
  );
  for (const name of [...undeclared].sort()) console.error(`  ${name}`);
  console.error(
    "\nAdd them to dependencies (or peerDependencies). They resolve here only\n" +
      "because npm hoists the app's node_modules; a consumer would get nothing.",
  );
  process.exit(1);
}

// A relative `url()` is resolved against the stylesheet that CONTAINS it, and
// sass inlines `@use`d rules without rewriting them — so a stylesheet that pulls
// in another from a different directory silently moves its asset references.
// That shipped once as an icon font 404ing in a host page; it is cheap to refuse.
const missing = [];
for (const file of walk(outDir).filter((f) => f.endsWith(".css"))) {
  const css = readFileSync(file, "utf8");
  for (const [, url] of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
    if (/^(data:|https?:|\/|#)/.test(url)) continue;
    const target = resolve(dirname(file), url.split(/[?#]/)[0]);
    try {
      statSync(target);
    } catch {
      missing.push(`${relative(pkgDir, file)} -> ${url}`);
    }
  }
}
if (missing.length) {
  console.error(
    `\n${pkg.name}: ${missing.length} asset reference(s) in the built CSS point at nothing:`,
  );
  for (const m of missing) console.error(`  ${m}`);
  process.exit(1);
}

const bytes = walk(outDir).reduce((n, f) => n + statSync(f).size, 0);
console.log(
  `${pkg.name}: ${code.length} module(s), ${styles.length + plainCss.length} stylesheet(s), ` +
    `${assets.length} asset(s) -> dist/ (${(bytes / 1024).toFixed(0)} KB)`,
);
