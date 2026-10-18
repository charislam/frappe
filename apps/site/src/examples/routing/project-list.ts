import { Sync, type SynchronousContext } from "@charismaticalli/frappe";
import { Option } from "effect";
import { projectCatalog } from "./catalog";
import { projectDestination } from "./routes";
import { routeLink } from "./ui";

export const projectList = (context: SynchronousContext) =>
  Sync.gen(function* () {
    const items = [];
    for (const project of projectCatalog) {
      items.push(
        yield* context.he("li", {
          children: [
            yield* context.he("div", {
              attrs: { class: Option.some("routing-project-summary") },
              children: [
                yield* context.he("h4", {
                  children: [
                    yield* routeLink(context, {
                      label: project.name,
                      destination: projectDestination({ id: project.id }),
                    }),
                  ],
                }),
                yield* context.he("p", { children: [project.description] }),
                yield* context.he("small", { children: [`${project.owner} · ${project.due}`] }),
              ],
            }),
            yield* context.he("div", {
              attrs: { class: Option.some("routing-project-actions") },
              children: [
                yield* context.he("span", {
                  attrs: {
                    class: Option.some("routing-status"),
                    "data-status": Option.some(project.status),
                  },
                  children: [project.status],
                }),
                yield* routeLink(context, {
                  label: `${project.name} settings`,
                  destination: projectDestination({ id: project.id, settings: true }),
                }),
              ],
            }),
          ],
        }),
      );
    }
    return yield* context.he("ul", {
      attrs: { class: Option.some("routing-project-list") },
      children: items,
    });
  });
