import { createHighlighter } from "shiki";
import type { DiscoveredFile } from "./discover.ts";

const highlighter = createHighlighter({
  themes: ["github-light", "github-dark"],
  langs: ["typescript", "tsx", "javascript", "jsx", "json"],
});
export const highlight = async (file: DiscoveredFile) => {
  try {
    return {
      ...file,
      html: (await highlighter).codeToHtml(file.source, {
        lang: file.language,
        themes: { light: "github-light", dark: "github-dark" },
        defaultColor: false,
        transformers: [
          {
            pre(node) {
              delete node.properties["tabindex"];
            },
            line(node, line) {
              node.children.unshift({
                type: "element",
                tagName: "span",
                properties: {
                  class: "source-line-number",
                  "aria-hidden": "true",
                  "data-line": line,
                },
                children: [],
              });
            },
          },
        ],
      }),
    };
  } catch (error) {
    throw new Error(`Cannot highlight ${file.path} (${file.language}): ${String(error)}`, {
      cause: error,
    });
  }
};
