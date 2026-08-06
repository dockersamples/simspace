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
import { SlideTerminal } from "../../Deck/SlideTerminal";
import { Fragment } from "../../Deck/Fragment";
import { Card, Stat, Tag } from "../../Deck/SlideParts";

export function MarkdownRenderer({ children, baseUrl }) {
  return (
    <MarkdownBaseUrlContext.Provider value={baseUrl}>
      <MarkdownHooks
        remarkPlugins={[
          remarkGfm,
          remarkCodeIndexer,
          remarkDirective,
          tabDirective,
          // After tabDirective: it replaces hProperties wholesale, and this
          // merges the fragment index into whatever it left there.
          remarkFragmentIndexer,
        ]}
        rehypePlugins={[rehypeRaw, rehypeMermaid, rehypeGithubAlerts]}
        components={{
          code: CodeBlock,
          a: ExternalLink,
          img: RenderedImage,
          svg: RenderedSvg,
          table: (props) => (
            <table className="table table-sm table-striped" {...props} />
          ),
          tbody: (props) => (
            <tbody className="table-group-divider" {...props} />
          ),
          tablink: TabLink,
          filelink: FileLink,
          variabledefinition: VariableDefinition,
          variablesetbutton: VariableSetButton,
          conditionaldisplay: ConditionalDisplay,
          // Deck directives. Registered here rather than in a separate renderer
          // so slides get the whole authoring surface — Run buttons, mermaid,
          // alerts, $$variables$$ — for free. Both degrade sanely outside a
          // deck: `::terminal` renders a terminal on the shared simulator (or
          // says there isn't one), and a `:::fragment` renders fully revealed.
          terminal: SlideTerminal,
          fragment: Fragment,
          stat: Stat,
          card: Card,
          tag: Tag,
        }}
      >
        {children}
      </MarkdownHooks>
    </MarkdownBaseUrlContext.Provider>
  );
}
