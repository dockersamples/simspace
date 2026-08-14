import { createContext, useContext } from "react";

// Base URL that relative asset paths in the markdown resolve against. Set per
// section (via MarkdownRenderer's `baseUrl` prop) so markdown nested in
// subdirectories still finds its images.
export const MarkdownBaseUrlContext = createContext(undefined);

export const useMarkdownBaseUrl = () => useContext(MarkdownBaseUrlContext);
