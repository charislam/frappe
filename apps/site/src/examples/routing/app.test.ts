import { Sync, component, mounting } from "@charismaticalli/frappe";
import { History, memoryHistory } from "@charismaticalli/frappe/router";
import { Deferred, Effect, Exit, Layer, Match, Option, Result, Scope } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { rendered } from "~/test-helpers";
import { RoutingDemo } from "./example";
import { MockAuth, MockProjects, ProjectError, mockAuth, mockProjects } from "./resources";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});

const fixture = async (initial: string, options = { failFirstProject: false }) => {
  let failNextProject = options.failFirstProject;
  const projectsLayer = Layer.effect(
    MockProjects,
    Effect.gen(function* () {
      const projects = yield* MockProjects;
      return MockProjects.of({
        ...projects,
        acquire: (id) =>
          Effect.suspend(() =>
            Match.value(failNextProject).pipe(
              Match.when(true, () => {
                failNextProject = false;
                return Effect.fail(
                  new ProjectError({ message: `Project ${id} could not be acquired` }),
                );
              }),
              Match.orElse(() => projects.acquire(id)),
            ),
          ),
      });
    }),
  ).pipe(Layer.provide(mockProjects));
  const scope = await Effect.runPromise(Scope.make());
  cleanups.push(() => Effect.runPromise(Scope.close(scope, Exit.void)));
  const history = await Effect.runPromise(
    memoryHistory({ initial }).pipe(Effect.provideService(Scope.Scope, scope)),
  );
  const ready = Deferred.makeUnsafe<{
    auth: Effect.Success<typeof MockAuth>;
  }>();
  const failures: unknown[] = [];

  const app = await Effect.runPromise(
    mounting({
      scope,
      resources: Layer.mergeAll(Layer.succeed(History, history), mockAuth, projectsLayer),
      onError: (failure) => {
        failures.push(failure);
      },
    }),
  );
  const parent = document.createElement("div");
  Effect.runSync(
    app.h(
      parent,
      component(() =>
        Sync.succeed({
          setup: () =>
            Effect.gen(function* () {
              const auth = yield* MockAuth;
              yield* Deferred.succeed(ready, { auth });
              return RoutingDemo;
            }),
        }),
      ),
    ),
  );

  const resources = await Effect.runPromise(Deferred.await(ready));
  const shows = (text: string) =>
    rendered({
      parent,
      check: () =>
        [...parent.querySelectorAll("h1, h2, h3, h4, p, output, button")].some(
          (node) => !node.closest("nav") && node.textContent?.includes(text) === true,
        ),
    });
  const press = (label: string) => {
    const node = [...parent.querySelectorAll("button, a")].find(
      (node) => node.textContent === label,
    );
    expect(node, `Missing control ${label}; failures: ${failures.length}`).toBeDefined();
    node?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  };
  await shows("Welcome to Waypoint");
  return { parent, history, shows, press, failures, ...resources };
};

describe("mock nested routing application", () => {
  it("resumes a private deep link after discovery/login and retains eligible shell state", async () => {
    const f = await fixture("/examples/routing/projects/123/settings");
    expect(f.parent.querySelector('[aria-label="Authenticated shell"]')).toBeNull();
    await f.shows("Sign in to continue");
    expect(f.history.location()).toBe("/examples/routing/login");
    f.press("Continue as Ada");
    await f.shows("Website launch settings");
    expect(f.history.location()).toBe("/examples/routing/projects/123/settings");
    const workspaceNote = Option.getOrThrow(
      Option.fromNullishOr(
        f.parent.querySelector<HTMLInputElement>('input[aria-label="Workspace note"]'),
      ),
    );
    workspaceNote.value = "Review the launch plan";
    workspaceNote.dispatchEvent(new Event("input", { bubbles: true }));
    f.press("Follow project");
    await f.shows("Following project");
    const input = f.parent.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Project brief"]',
    );
    expect(input).not.toBeNull();
    Match.value(input).pipe(
      Match.when(
        (node): node is HTMLTextAreaElement => node !== null,
        (node) => {
          node.value = "live note";
          node.dispatchEvent(new Event("input", { bubbles: true }));
        },
      ),
      Match.orElse(() => {}),
    );
    f.parent
      .querySelector('form[aria-label="Project settings"]')
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await f.shows("Project saved.");
    f.press("Overview");
    await f.shows("Website launch overview");
    expect(
      f.parent.querySelector<HTMLInputElement>('input[aria-label="Workspace note"]')?.value,
    ).toBe("Review the launch plan");
    expect(f.parent.textContent).toContain("Following project");
    f.press("Dashboard");
    await f.shows("Welcome back, Ada.");
    expect(
      f.parent.querySelector<HTMLInputElement>('input[aria-label="Workspace note"]')?.value,
    ).toBe("Review the launch plan");
    await Effect.runPromise(f.auth.signIn({ name: "Ada" }));
    await f.shows("Welcome back, Ada.");
    expect(
      f.parent.querySelector<HTMLInputElement>('input[aria-label="Workspace note"]')?.value,
    ).toBe("Review the launch plan");
    await Effect.runPromise(f.auth.signIn({ name: "Grace" }));
    await f.shows("Welcome back, Grace.");
    expect(
      f.parent.querySelector<HTMLInputElement>('input[aria-label="Workspace note"]')?.value,
    ).toBe("");
    expect(f.failures).toEqual([]);
  });

  it("defers malformed private URLs without acquiring a project and restores their URL after login", async () => {
    const f = await fixture("/examples/routing/projects/wrong-id");
    await f.shows("Sign in to continue");
    expect(f.history.location()).toBe("/examples/routing/login");
    await Effect.runPromise(f.auth.signIn({ name: "Ada" }));
    await f.shows("Invalid project URL");
    expect(f.history.location()).toBe("/examples/routing/projects/wrong-id");
    expect(f.parent.querySelector('[aria-label="Projects shell"]')).not.toBeNull();
    expect(f.parent.querySelector('[aria-label="Project shell"]')).toBeNull();
    expect(f.failures).toEqual([]);
  });

  it("renders nested URL errors and returns to the project through normal navigation", async () => {
    const f = await fixture("/examples/routing/projects/123/doesnt-exist");
    await Effect.runPromise(f.auth.signIn({ name: "Ada" }));
    await f.shows("We couldn’t find “doesnt-exist” in this project.");
    expect(f.parent.querySelector('[aria-label="Project shell"]')).not.toBeNull();
    f.press("Overview");
    await f.shows("Website launch overview");
    f.press("All projects");
    await f.shows("Your projects");
    f.press("Website launch settings");
    await f.shows("Website launch settings");
    expect(f.failures).toEqual([]);
  });
});

it("keeps the page on rejected history writes and reconciles a denied traversal explicitly", async () => {
  const f = await fixture("/examples/routing/projects/123/settings");
  await Effect.runPromise(f.auth.signIn({ name: "Ada" }));
  await f.shows("Website launch settings");
  f.history.failNextWrite("reject dashboard");
  f.press("Dashboard");
  await f.shows("Navigation failed");
  expect(f.history.location()).toBe("/examples/routing/projects/123/settings");
  expect(f.parent.textContent).toContain("Website launch settings");
  f.press("Dashboard");
  await f.shows("Welcome back, Ada.");
  await Effect.runPromise(f.auth.logout);
  await f.shows("Sign in to continue");
  f.history.failNextWrite("reject denied traversal redirect");
  Result.getOrThrow(f.history.traverse(-1));
  await f.shows("Navigation failed");
  expect(f.history.location()).toBe("/examples/routing/projects/123/settings");
  expect(f.parent.querySelector('[aria-label="Authenticated shell"]')).toBeNull();
  f.press("Restore previous page");
  await rendered({
    parent: f.parent,
    check: () =>
      f.history.location() === "/examples/routing/login" &&
      !f.parent.textContent?.includes("Navigation failed"),
  });
  expect(f.failures).toEqual([]);
});

it("resets project ownership on direct project changes and separates acquisition failures from URL errors", async () => {
  const f = await fixture("/examples/routing/projects/123", { failFirstProject: true });
  await Effect.runPromise(f.auth.signIn({ name: "Ada" }));
  await f.shows("Project 123 could not be acquired");
  expect(f.history.location()).toBe("/examples/routing/projects/123");
  f.press("Retry project");
  await f.shows("Website launch overview");
  f.press("Follow project");
  await f.shows("Following project");
  f.press("All projects");
  await f.shows("Your projects");
  f.press("Mobile onboarding");
  await f.shows("Mobile onboarding overview");
  expect(f.parent.textContent).not.toContain("Following project");
  f.press("Sign out");
  await f.shows("Sign in to continue");
  expect(f.history.location()).toBe("/examples/routing/login");
  expect(f.parent.querySelector('[aria-label="Project shell"]')).toBeNull();
  await Effect.runPromise(f.auth.signIn({ name: "Grace" }));
  await f.shows("Signed in as Grace");
  await f.shows("Welcome back, Grace.");
  expect(f.history.location()).toBe("/examples/routing");
  expect(f.failures).toEqual([]);
});

it("keeps project work across nested routes, saves briefs, and follows browser history", async () => {
  const f = await fixture("/examples/routing/projects/123");
  await Effect.runPromise(f.auth.signIn({ name: "Ada" }));
  await f.shows("Website launch overview");
  const shell = f.parent.querySelector('[aria-label="Project shell"]');
  const workspace = f.parent.querySelector('[aria-label="Authenticated shell"]');
  expect(
    f.parent.querySelector('nav[aria-label="Project pages"] [aria-current="page"]')?.textContent,
  ).toBe("Overview");
  f.press("Complete next milestone");
  await f.shows("1 of 3 milestones complete");
  f.press("Settings");
  await f.shows("Website launch settings");
  const brief = Option.getOrThrow(
    Option.fromNullishOr(
      f.parent.querySelector<HTMLTextAreaElement>('textarea[aria-label="Project brief"]'),
    ),
  );
  brief.value = "Ship an accessible website with a clear product story.";
  brief.dispatchEvent(new Event("input", { bubbles: true }));
  f.parent
    .querySelector('form[aria-label="Project settings"]')
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await f.shows("Project saved.");
  expect(f.history.location()).toBe("/examples/routing/projects/123/settings");
  f.press("Overview");
  await f.shows("1 of 3 milestones complete");
  expect(f.parent.querySelector('[aria-label="Project shell"]')).toBe(shell);
  Result.getOrThrow(f.history.traverse(-1));
  await f.shows("Website launch settings");
  expect(
    f.parent.querySelector<HTMLTextAreaElement>('textarea[aria-label="Project brief"]')?.value,
  ).toBe("Ship an accessible website with a clear product story.");
  expect(
    f.parent.querySelector('nav[aria-label="Project pages"] [aria-current="page"]')?.textContent,
  ).toBe("Settings");
  Result.getOrThrow(f.history.traverse(1));
  await f.shows("1 of 3 milestones complete");
  f.press("All projects");
  await f.shows("Your projects");
  expect(f.parent.querySelector('[aria-label="Authenticated shell"]')).toBe(workspace);
  f.press("Website launch settings");
  await f.shows("Website launch settings");
  expect(
    f.parent.querySelector<HTMLTextAreaElement>('textarea[aria-label="Project brief"]')?.value,
  ).toBe("Ship an accessible website with a clear product story.");
  f.press("Overview");
  await f.shows("1 of 3 milestones complete");
  expect(f.failures).toEqual([]);
});

it("offers a route back to the project list when a project no longer exists", async () => {
  const f = await fixture("/examples/routing/projects/999");
  await Effect.runPromise(f.auth.signIn({ name: "Ada" }));
  await f.shows("This project does not exist or you no longer have access.");
  expect(f.parent.querySelector('[aria-label="Project shell"]')).toBeNull();
  expect(f.history.location()).toBe("/examples/routing/projects/999");
  f.press("Back to projects");
  await f.shows("Your projects");
  expect(f.history.location()).toBe("/examples/routing/projects");
  expect(f.failures).toEqual([]);
});
