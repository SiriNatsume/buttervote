import type { Parent, Root } from "mdast";
import type { Plugin } from "unified";

const remarkImageWidth: Plugin<[], Root> = () => (tree, file) => {
  const source = String(file);

  function visit(parent: Parent) {
    for (const [index, node] of parent.children.entries()) {
      if ("children" in node) visit(node);
      if (node.type !== "image" && node.type !== "imageReference") continue;

      const suffix = parent.children[index + 1];
      if (suffix?.type !== "text") continue;

      const offset = node.position?.end.offset;
      if (offset === undefined || suffix.position?.start.offset !== offset) continue;

      const match = /^\{width=(\d+)\}/.exec(suffix.value);
      // The parser decodes escapes and entities in text values.
      if (!match || !source.startsWith(match[0], offset)) continue;

      const width = Number(match[1]);
      if (!Number.isSafeInteger(width) || width < 1) continue;

      const data = (node.data ??= {});
      data.hProperties = { ...data.hProperties, width };
      suffix.value = suffix.value.slice(match[0].length);
    }
  }

  visit(tree);
};

export default remarkImageWidth;
