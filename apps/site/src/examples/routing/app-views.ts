import { Sync, branch, cases, component, focus, provideContext } from "@charismaticalli/frappe";
import { Effect, Match, Option } from "effect";
import { CurrentUser, SessionIdentity } from "./context";
import type { AppState, PrivatePage } from "./model";
import { projectList } from "./project-list";
import { InvalidProject, MissingProject, ProjectBranch, ProjectIndex } from "./project-views";
import { MockAuth } from "./resources";
import { dashboard, projects } from "./routes";
import { button, message, routeLink, workspaceNote } from "./ui";

export const Anonymous = branch<Extract<AppState, { _tag: "Anonymous" }>>()(({ context }) =>
  Sync.gen(function* () {
    const auth = yield* Sync.service(MockAuth);
    const output = yield* context.he("article", {
      children: [
        yield* context.he("h3", { children: ["Welcome to Waypoint"] }),
        yield* message(
          context,
          "Sign in to continue to your projects. We’ll take you back to the page you requested.",
        ),
        yield* button(context, { label: "Continue as Ada", action: auth.signIn({ name: "Ada" }) }),
        yield* context.he("small", { children: ["Demo workspace · sample account"] }),
      ],
    });
    return { setup: () => Effect.succeed(output) };
  }),
);

export const Resolving = branch<Extract<AppState, { _tag: "ResolvingSession" }>>()(({ context }) =>
  Sync.gen(function* () {
    const output = yield* message(context, "Opening your workspace…");
    return { setup: () => Effect.succeed(output) };
  }),
);

const Dashboard = branch<Extract<PrivatePage, { _tag: "Dashboard" }>>()(({ context }) =>
  Sync.gen(function* () {
    const user = yield* Sync.service(CurrentUser);
    const title = yield* context.derive({
      sources: { user },
      compute: ({ user }) => `Welcome back, ${user.name}.`,
    });
    const output = yield* context.he("article", {
      attrs: { class: Option.some("routing-dashboard") },
      children: [
        yield* context.he("h3", { children: [title] }),
        yield* context.he("p", { children: ["Keep your team’s next steps in view."] }),
        yield* context.he("h4", {
          attrs: { class: Option.some("routing-section-label") },
          children: ["Active projects"],
        }),
        yield* projectList(context),
      ],
    });
    return { setup: () => Effect.succeed(output) };
  }),
);

const Projects = branch<Extract<PrivatePage, { _tag: "Projects" }>>()(({ context, inputs }) =>
  Sync.gen(function* () {
    const page = yield* focus({ context, source: inputs.state, key: "page" });
    const output = yield* context.he("section", {
      attrs: { "aria-label": Option.some("Projects shell") },
      children: [
        yield* context.he("p", {
          attrs: { class: Option.some("routing-section-label") },
          children: ["Projects"],
        }),
        cases({
          state: page,
          branches: {
            Index: { branch: ProjectIndex },
            InvalidUrl: { branch: InvalidProject },
            NotFound: { branch: MissingProject },
            Project: { branch: ProjectBranch, key: (state) => state.projectId },
          },
        }),
      ],
    });
    return { setup: () => Effect.succeed(output) };
  }),
);

const RootNotFound = branch<Extract<PrivatePage, { _tag: "NotFound" }>>()(({ context }) =>
  Sync.gen(function* () {
    const output = yield* message(context, "Root page not found");
    return { setup: () => Effect.succeed(output) };
  }),
);

const RootInvalid = branch<Extract<PrivatePage, { _tag: "InvalidUrl" }>>()(({ context }) =>
  Sync.gen(function* () {
    const output = yield* message(context, "Invalid root URL");
    return { setup: () => Effect.succeed(output) };
  }),
);

export const Authenticated = branch<Extract<AppState, { _tag: "Authenticated" }>>()(
  ({ context, inputs }) =>
    Sync.gen(function* () {
      const user = yield* context.derive({
        sources: { state: inputs.state },
        compute: ({ state }) => state.user,
      });
      const { sessionId } = yield* context.read(inputs.state);
      const page = yield* focus({ context, source: inputs.state, key: "page" });

      const shell = component((context) =>
        Sync.gen(function* () {
          const user = yield* Sync.service(CurrentUser);
          const title = yield* context.derive({
            sources: { user },
            compute: ({ user }) => `Signed in as ${user.name}`,
          });
          const auth = yield* Sync.service(MockAuth);
          const navigation = [];
          for (const entry of [
            { tag: "Dashboard", title: "Dashboard", destination: dashboard },
            { tag: "Projects", title: "All projects", destination: projects },
          ] as const) {
            const link = yield* routeLink(context, {
              label: entry.title,
              destination: entry.destination,
            });
            const current = yield* context.derive({
              sources: { page },
              compute: ({ page }) =>
                Match.value(page._tag === entry.tag).pipe(
                  Match.when(true, () => Option.some("page")),
                  Match.orElse(() => Option.none<string>()),
                ),
            });
            yield* context.bind({ element: link, attrs: { "aria-current": current } });
            navigation.push(link);
          }
          const output = yield* context.he("section", {
            attrs: {
              "aria-label": Option.some("Authenticated shell"),
              class: Option.some("routing-workspace"),
            },
            children: [
              yield* context.he("aside", {
                attrs: { class: Option.some("routing-sidebar") },
                children: [
                  yield* context.he("p", {
                    attrs: { class: Option.some("routing-account") },
                    children: [title],
                  }),
                  yield* context.he("nav", {
                    attrs: { "aria-label": Option.some("Workspace pages") },
                    children: [
                      ...navigation,
                      yield* button(context, { label: "Sign out", action: auth.logout }),
                    ],
                  }),
                  yield* workspaceNote(context),
                ],
              }),
              yield* context.he("div", {
                attrs: { class: Option.some("routing-main") },
                children: [
                  cases({
                    state: page,
                    branches: {
                      Dashboard: { branch: Dashboard },
                      Projects: { branch: Projects },
                      NotFound: { branch: RootNotFound },
                      InvalidUrl: { branch: RootInvalid },
                    },
                  }),
                ],
              }),
            ],
          });
          return { setup: () => Effect.succeed(output) };
        }),
      );

      const withSession = provideContext({ key: SessionIdentity, value: sessionId, child: shell });

      return {
        setup: () =>
          Effect.succeed(provideContext({ key: CurrentUser, value: user, child: withSession })),
      };
    }),
);
