import { Sync, branch, cases, component, focus, provideContext } from "@charismaticalli/frappe";
import { Effect, Match, Option } from "effect";
import {
  CurrentProject,
  Navigation,
  ProjectIdentity,
  ProjectProgress,
  SessionIdentity,
} from "./context";
import type { ProjectPage, ProjectState, ProjectsPage } from "./model";
import { projectList } from "./project-list";
import { MockProjects } from "./resources";
import { projectDestination, projects } from "./routes";
import { button, message, routeLink } from "./ui";

const Overview = branch<Extract<ProjectPage, { _tag: "Overview" }>>()(({ context }) =>
  Sync.gen(function* () {
    const project = yield* Sync.service(CurrentProject);
    const title = yield* context.derive({
      sources: { project },
      compute: ({ project }) => `${project.name} overview`,
    });
    const edits = yield* Sync.service(ProjectProgress);
    const value = yield* context.derive({
      sources: { edits },
      compute: ({ edits }) => `${edits} of 3 milestones complete`,
    });
    const done = yield* context.derive({ sources: { edits }, compute: ({ edits }) => edits >= 3 });
    const complete = yield* context.he("button", {
      props: { type: "button", disabled: done },
      children: ["Complete next milestone"],
    });
    yield* context.subscribe(yield* context.events(complete, "click"), () =>
      edits.update((n) => Math.min(n + 1, 3)),
    );
    const output = yield* context.he("article", {
      children: [
        yield* context.he("h4", { children: [title] }),
        yield* context.he("p", {
          children: ["Track the work that takes this project from an idea to delivery."],
        }),
        yield* context.he("ol", {
          children: [
            yield* context.he("li", { children: ["Confirm the brief"] }),
            yield* context.he("li", { children: ["Review the first draft"] }),
            yield* context.he("li", { children: ["Approve for launch"] }),
          ],
        }),
        yield* context.he("output", { children: [value] }),
        complete,
      ],
    });
    return { setup: () => Effect.succeed(output) };
  }),
);

const Settings = branch<Extract<ProjectPage, { _tag: "Settings" }>>()(({ context, inputs }) =>
  Sync.gen(function* () {
    const project = yield* Sync.service(CurrentProject);
    const note = yield* focus({ context, source: inputs.state, key: "note" });
    return {
      fallback: (context) => message(context, "Loading project settings…"),
      setup: (context) =>
        Effect.gen(function* () {
          const service = yield* MockProjects;
          const snapshot = yield* project.get;
          yield* note.set(yield* service.brief(snapshot.id));
          const feedback = yield* context.signal({ initial: "" });
          const input = yield* context.he("textarea", {
            attrs: { "aria-label": Option.some("Project brief"), rows: Option.some("4") },
            props: { required: true },
          });
          yield* context.bindValue({ element: input, signal: note });
          const form = yield* context.he("form", {
            attrs: { "aria-label": Option.some("Project settings") },
            children: [
              yield* context.he("h4", { children: [`${snapshot.name} settings`] }),
              yield* context.he("p", {
                children: ["Give your team a clear brief for this project."],
              }),
              yield* context.he("label", { children: ["Project brief", input] }),
              yield* context.he("button", {
                attrs: { class: Option.some("primary") },
                props: { type: "submit" },
                children: ["Save project"],
              }),
              yield* context.he("p", {
                attrs: { role: Option.some("status") },
                children: [feedback],
              }),
            ],
          });
          yield* context.subscribe(
            yield* context.events(form, "submit", {
              synchronous: (event) => event.preventDefault(),
            }),
            () =>
              Effect.gen(function* () {
                const brief = (yield* note.get).trim();
                yield* Match.value(brief.length > 0).pipe(
                  Match.when(false, () => feedback.set("Enter a project brief before saving.")),
                  Match.when(true, () =>
                    service
                      .saveBrief({ id: snapshot.id, brief })
                      .pipe(Effect.andThen(feedback.set("Project saved."))),
                  ),
                  Match.exhaustive,
                );
              }),
          );
          return form;
        }),
    };
  }),
);

const MissingChild = branch<Extract<ProjectPage, { _tag: "NotFound" }>>()(({ context, inputs }) =>
  Sync.gen(function* () {
    const label = yield* context.derive({
      sources: { state: inputs.state },
      compute: ({ state }) => `We couldn’t find “${state.remainder.join("/")}” in this project.`,
    });
    const output = yield* context.he("p", { children: [label] });
    return { setup: () => Effect.succeed(output) };
  }),
);

const InvalidChild = branch<Extract<ProjectPage, { _tag: "InvalidUrl" }>>()(({ context }) =>
  Sync.gen(function* () {
    const output = yield* message(context, "Invalid URL within this project");
    return { setup: () => Effect.succeed(output) };
  }),
);

const Ready = branch<Extract<ProjectState, { _tag: "Ready" }>>()(({ context, inputs }) =>
  Sync.gen(function* () {
    const project = yield* context.derive({
      sources: { state: inputs.state },
      compute: ({ state }) => state.project,
    });
    const page = yield* focus({ context, source: inputs.state, key: "page" });
    const progress = yield* context.signal({ initial: 0 });
    const saved = yield* context.signal({ initial: false });
    const sessionId = yield* Sync.service(SessionIdentity);
    const snapshot = yield* context.read(project);
    const work = yield* context.derive({
      sources: { progress, saved },
      compute: ({ progress, saved }) => ({ milestones: progress, following: saved }),
    });
    const shell = component((context) =>
      Sync.gen(function* () {
        const project = yield* Sync.service(CurrentProject);
        const snapshot = yield* context.read(project);
        const saveLabel = yield* context.derive({
          sources: { saved },
          compute: ({ saved }) =>
            Match.value(saved).pipe(
              Match.when(true, () => "Following project"),
              Match.orElse(() => "Follow project"),
            ),
        });
        const pressed = yield* context.derive({
          sources: { saved },
          compute: ({ saved }) => Option.some(String(saved)),
        });
        const follow = yield* context.he("button", {
          attrs: { class: Option.some("routing-follow"), "aria-pressed": pressed },
          props: { type: "button" },
          children: [saveLabel],
        });
        yield* context.subscribe(yield* context.events(follow, "click"), () =>
          saved.update((saved) => !saved),
        );
        const tabs = [];
        for (const entry of [
          {
            tag: "Overview",
            title: "Overview",
            destination: projectDestination({ id: snapshot.id }),
          },
          {
            tag: "Settings",
            title: "Settings",
            destination: projectDestination({ id: snapshot.id, settings: true }),
          },
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
          tabs.push(link);
        }
        const output = yield* context.he("section", {
          attrs: {
            "aria-label": Option.some("Project shell"),
            class: Option.some("routing-project"),
          },
          children: [
            yield* context.he("header", {
              attrs: { class: Option.some("routing-project-heading") },
              children: [yield* context.he("h3", { children: [snapshot.name] }), follow],
            }),
            yield* context.he("nav", {
              attrs: {
                class: Option.some("routing-project-nav"),
                "aria-label": Option.some("Project pages"),
              },
              children: tabs,
            }),
            cases({
              state: page,
              branches: {
                Overview: { branch: Overview },
                Settings: { branch: Settings },
                NotFound: { branch: MissingChild },
                InvalidUrl: { branch: InvalidChild },
              },
            }),
          ],
        });
        return { setup: () => Effect.succeed(output) };
      }),
    );
    return {
      setup: (context) =>
        Effect.gen(function* () {
          const service = yield* MockProjects;
          const restored = yield* service.work({ sessionId, id: snapshot.id });
          yield* progress.set(restored.milestones);
          yield* saved.set(restored.following);
          yield* context.subscribeStream(yield* work.changes, (work) =>
            service.saveWork({ sessionId, id: snapshot.id, work }),
          );
          return provideContext({
            key: CurrentProject,
            value: project,
            child: provideContext({ key: ProjectProgress, value: progress, child: shell }),
          });
        }),
    };
  }),
);

const Loading = branch<Extract<ProjectState, { _tag: "Loading" }>>()(({ context, inputs }) =>
  Sync.gen(function* () {
    const sessionId = yield* Sync.service(SessionIdentity);
    const { id } = yield* Sync.service(ProjectIdentity);
    const navigator = yield* Sync.service(Navigation);
    const { requestId } = yield* context.read(inputs.state);
    return {
      fallback: (context) => message(context, "Loading project…"),
      setup: () =>
        Effect.gen(function* () {
          const projects = yield* MockProjects;
          const result = yield* projects.acquire(id).pipe(
            Effect.match({
              onFailure: ({ message }) => ({ _tag: "Failure" as const, message }),
              onSuccess: (project) => ({ _tag: "Success" as const, project }),
            }),
          );
          yield* navigator.dispatch({
            _tag: "ProjectFinished",
            sessionId,
            projectId: id,
            requestId,
            result,
          });
          return [];
        }),
    };
  }),
);

const Failed = branch<Extract<ProjectState, { _tag: "Failed" }>>()(({ context, inputs }) =>
  Sync.gen(function* () {
    const navigation = yield* Sync.service(Navigation);
    const label = yield* context.derive({
      sources: { state: inputs.state },
      compute: ({ state }) => state.message,
    });
    const output = yield* context.he("div", {
      children: [
        yield* context.he("p", { attrs: { role: Option.some("alert") }, children: [label] }),
        yield* button(context, {
          label: "Retry project",
          action: navigation.dispatch({ _tag: "RetryProject" }),
        }),
        yield* routeLink(context, { label: "Back to projects", destination: projects }),
      ],
    });
    return { setup: () => Effect.succeed(output) };
  }),
);
export const ProjectBranch = branch<Extract<ProjectsPage, { _tag: "Project" }>>()(
  ({ context, inputs }) =>
    Sync.gen(function* () {
      const { projectId: id } = yield* context.read(inputs.state);
      const state = yield* focus({ context, source: inputs.state, key: "state" });
      const child = component(() =>
        Sync.succeed({
          setup: () =>
            Effect.succeed(
              cases({
                state,
                branches: {
                  Loading: { branch: Loading },
                  Failed: { branch: Failed },
                  Ready: { branch: Ready },
                },
              }),
            ),
        }),
      );
      return {
        setup: () => Effect.succeed(provideContext({ key: ProjectIdentity, value: { id }, child })),
      };
    }),
);
export const ProjectIndex = branch<Extract<ProjectsPage, { _tag: "Index" }>>()(({ context }) =>
  Sync.gen(function* () {
    const output = yield* context.he("div", {
      children: [
        yield* context.he("h4", { children: ["Your projects"] }),
        yield* context.he("p", {
          children: ["Explore the work your team is planning and delivering."],
        }),
        yield* projectList(context),
      ],
    });
    return { setup: () => Effect.succeed(output) };
  }),
);
export const InvalidProject = branch<Extract<ProjectsPage, { _tag: "InvalidUrl" }>>()(
  ({ context }) =>
    Sync.gen(function* () {
      const output = yield* message(
        context,
        "Invalid project URL. Check the address or choose a project from All projects.",
      );
      return { setup: () => Effect.succeed(output) };
    }),
);
export const MissingProject = branch<Extract<ProjectsPage, { _tag: "NotFound" }>>()(({ context }) =>
  Sync.gen(function* () {
    const output = yield* message(
      context,
      "We couldn’t find that page. Choose a project from All projects.",
    );
    return { setup: () => Effect.succeed(output) };
  }),
);
