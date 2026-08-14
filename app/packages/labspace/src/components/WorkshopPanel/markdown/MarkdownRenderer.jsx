import { MarkdownHooks } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeMermaid from "rehype-mermaid";
import remarkDirective from "remark-directive";
import { rehypeGithubAlerts } from "rehype-github-alerts";
import { CodeBlock } from "./CodeBlock";
import { remarkCodeIndexer } from "./codeIndexer";
import { ExternalLink } from "./ExternalLink";
import { RenderedImage } from "./RenderedImage";
import { RenderedSvg } from "./RenderedSvg";
import { tabDirective } from "./reactDirective";
import { remarkFragmentIndexer } from "./fragmentIndexer";
import { TabLink } from "./TabLink";
import { FileLink } from "./FileLink";
import { VariableDefinition } from "./VariableDefinition";
import { VariableSetButton } from "./VariableSetButton";
import { ConditionalDisplay } from "./ConditionalDisplay";
import { MarkdownBaseUrlContext } from "./markdownBaseUrl";
import { diagramErrorFallback } from "./diagramError";
import "./MarkdownRenderer.scss";

// Mermaid renders in the browser here, so a diagram can fail on one device and not
// another. Without a fallback `rehype-mermaid` throws, `MarkdownHooks` rethrows the
// plugin error during render, and the app unmounts — see diagramError.js.
const mermaidOptions = { errorFallback: diagramErrorFallback };

/**
 * `runButtons` controls whether a code fence gets a Run button by default.
 * A lab's fences are commands to run, so they do; a deck passes
 * `"terminal-only"` because slide code is overwhelmingly a sample being read,
 * and only a live-demo fence (`terminal-id=`) is meant to be executed.
 *
 * `components` registers EXTRA directive components on top of the lab
 * authoring surface below. This is how a host adds its own `:::directive`
 * without the renderer having to know it exists — the lab app's slide deck
 * registers `::terminal`, `:::fragment`, `:::stat`, `:::card` and `:tag` this
 * way. Extra components are merged last, so a host can also override a built-in
 * (e.g. swap `img` for its own image component) deliberately.
 */
export function MarkdownRenderer({
  children,
  baseUrl,
  runButtons = "default",
  components,
}) {
  return (
    <MarkdownBaseUrlContext.Provider value={baseUrl}>
      <MarkdownHooks
        remarkPlugins={[
          remarkGfm,
          [remarkCodeIndexer, { runButtons }],
          remarkDirective,
          tabDirective,
          // After tabDirective: it replaces hProperties wholesale, and this
          // merges the fragment index into whatever it left there.
          remarkFragmentIndexer,
        ]}
        rehypePlugins={[
          rehypeRaw,
          [rehypeMermaid, mermaidOptions],
          rehypeGithubAlerts,
        ]}
        components={{
          code: CodeBlock,
          a: ExternalLink,
          img: RenderedImage,
          svg: RenderedSvg,
          table: (props) => <table className="md-table" {...props} />,
          tablink: TabLink,
          filelink: FileLink,
          variabledefinition: VariableDefinition,
          variablesetbutton: VariableSetButton,
          conditionaldisplay: ConditionalDisplay,
          // Host-supplied directives last, so a host can extend the surface —
          // and, deliberately, override a built-in.
          ...components,
        }}
      >
        {children}
      </MarkdownHooks>
    </MarkdownBaseUrlContext.Provider>
  );
}
