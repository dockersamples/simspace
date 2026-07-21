import Image from "react-bootstrap/Image";
import { useWorkshop } from "../../../WorkshopContext";
import { useMarkdownBaseUrl } from "./markdownBaseUrl";

// Resolves a markdown image `src` against the lab's base directory so relative
// paths (e.g. `diagram.png` sitting next to the .md file) load in the browser.
// Absolute URLs (http:, data:, root-relative `/foo`) are left untouched — the
// URL constructor ignores the base for those.
function resolveSrc(src, baseUrl) {
  if (!src || !baseUrl) return src;
  try {
    return new URL(src, baseUrl).toString();
  } catch {
    return src;
  }
}

export function RenderedImage({ src, alt, node, ...rest }) {
  // The section's own directory when available, else the lab root.
  const sectionBaseUrl = useMarkdownBaseUrl();
  const { baseUrl: labBaseUrl } = useWorkshop();
  const baseUrl = sectionBaseUrl ?? labBaseUrl;
  return <Image src={resolveSrc(src, baseUrl)} alt={alt} {...rest} fluid />;
}
