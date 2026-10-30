import { Match, Option, Result } from "effect";
import { calculateSync, requireValidSync } from "~/reactive/runtime";
import type { Snapshot, Tag } from "./head-resolver";

const selector =
  'title, link[rel="canonical"], meta[name="description"], meta[name="robots"], meta[name^="twitter:"], meta[property^="og:"]';
/** Mark initial owned tags with data-frappe-head; all other head content is preserved. */
export const browser = (document: Document) =>
  Result.gen(function* () {
    const conflicts = [...document.head.querySelectorAll(selector)].filter(
      (node) => !node.hasAttribute("data-frappe-head"),
    );
    yield* requireValidSync(
      conflicts.length === 0,
      "Head bootstrap conflict: mark initial metadata with data-frappe-head or remove it",
    );
    const baseline = [...document.head.querySelectorAll("[data-frappe-head]")].map((node) => ({
      node,
      copy: node.cloneNode(true),
      next: node.nextSibling,
    }));
    const nodes = new Map<string, Element>();
    let disposed = false;
    const write = (snapshot: Snapshot) =>
      Result.gen(function* () {
        yield* requireValidSync(!disposed, "Head adapter disposed");
        yield* calculateSync(() => {
          const desired: Array<Tag> = [
            ...Option.toArray(
              Option.map(snapshot.title, (text): Tag => ({
                key: "title",
                element: "title",
                attributes: {},
                text,
              })),
            ),
            ...snapshot.tags,
          ];
          const keys = new Set(desired.map((tag) => tag.key));
          for (const [key, node] of nodes) {
            Match.value(keys.has(key)).pipe(
              Match.when(false, () => {
                node.remove();
                nodes.delete(key);
              }),
              Match.orElse(() => {}),
            );
          }
          for (const tag of desired) {
            const adopted = baseline.find(
              ({ node }) =>
                ![...nodes.values()].includes(node) &&
                node.localName === tag.element &&
                (tag.element === "title" ||
                  Object.entries(tag.attributes).every(
                    ([name, value]) =>
                      name === "content" || name === "href" || node.getAttribute(name) === value,
                  )),
            );
            const node = nodes.get(tag.key) ?? adopted?.node ?? document.createElement(tag.element);
            for (const attribute of [...node.attributes]) node.removeAttribute(attribute.name);
            node.setAttribute("data-frappe-head", tag.key);
            for (const [name, value] of Object.entries(tag.attributes))
              node.setAttribute(name, value);
            Option.map(Option.fromUndefinedOr(tag.text), (text) => {
              node.textContent = text;
            });
            document.head.append(node);
            nodes.set(tag.key, node);
          }
          for (const { node } of baseline) {
            Match.value([...nodes.values()].includes(node)).pipe(
              Match.when(false, () => node.remove()),
              Match.orElse(() => {}),
            );
          }
        });
      });
    return {
      write,
      dispose: () => {
        disposed = true;
        for (const node of nodes.values()) node.remove();
        for (const { node, copy, next } of [...baseline].reverse()) {
          for (const attribute of [...node.attributes]) node.removeAttribute(attribute.name);
          for (const attribute of [...(copy as Element).attributes])
            node.setAttribute(attribute.name, attribute.value);
          node.textContent = copy.textContent;
          document.head.insertBefore(node, next?.parentNode === document.head ? next : null);
        }
      },
    };
  });
