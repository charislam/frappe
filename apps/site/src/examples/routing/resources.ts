import { Resource } from "@charismaticalli/frappe";
import { Effect, Layer, Option, Ref, Schema, type Stream, SubscriptionRef } from "effect";
import { projectCatalog } from "./catalog";
import type { AuthEvent, Project, ProjectWork, User } from "./model";
import type { ProjectId } from "./routes";

export class MockAuth extends Resource.Service<
  MockAuth,
  {
    readonly sessions: Stream.Stream<AuthEvent>;
    readonly signIn: (user: User) => Effect.Effect<void>;
    readonly logout: Effect.Effect<void>;
  }
>()("RoutingDemo/Auth") {}

export const mockAuth = Layer.effect(
  MockAuth,
  Effect.gen(function* () {
    const session = yield* SubscriptionRef.make<AuthEvent>({ _tag: "Ended", reason: "discovery" });
    let sessionSequence = 0;
    return MockAuth.of({
      sessions: SubscriptionRef.changes(session),
      signIn: Effect.fn("MockAuth.signIn")(function* (user: User) {
        yield* SubscriptionRef.set(session, {
          _tag: "Session",
          sessionId: `session-${++sessionSequence}`,
          user,
        });
      }),
      logout: SubscriptionRef.set(session, { _tag: "Ended", reason: "logout" }),
    });
  }),
);

export class ProjectError extends Schema.TaggedError<ProjectError>()("DemoProjectError", {
  message: Schema.String,
}) {}

export class MockProjects extends Resource.Service<
  MockProjects,
  {
    readonly acquire: (id: ProjectId) => Effect.Effect<Project, ProjectError>;
    readonly work: (options: { sessionId: string; id: ProjectId }) => Effect.Effect<ProjectWork>;
    readonly saveWork: (options: {
      sessionId: string;
      id: ProjectId;
      work: ProjectWork;
    }) => Effect.Effect<void>;
    readonly brief: (id: ProjectId) => Effect.Effect<string>;
    readonly saveBrief: (options: { id: ProjectId; brief: string }) => Effect.Effect<void>;
  }
>()("RoutingDemo/Projects") {}

export const mockProjects = Layer.effect(
  MockProjects,
  Effect.gen(function* () {
    const workspaces = yield* Ref.make<ReadonlyMap<string, ProjectWork>>(new Map());
    const briefs = yield* Ref.make<ReadonlyMap<ProjectId, string>>(new Map());
    const acquire = Effect.fn("MockProjects.acquire")(
      (id: ProjectId): Effect.Effect<Project, ProjectError> =>
        Option.match(Option.fromUndefinedOr(projectCatalog.find((project) => project.id === id)), {
          onNone: () =>
            Effect.fail(
              new ProjectError({
                message: "This project does not exist or you no longer have access.",
              }),
            ),
          onSome: (project) => Effect.succeed<Project>({ id: project.id, name: project.name }),
        }),
    );
    return MockProjects.of({
      acquire,
      work: Effect.fn("MockProjects.work")(
        ({ sessionId, id }: { sessionId: string; id: ProjectId }) =>
          Ref.get(workspaces).pipe(
            Effect.map(
              (workspaces) =>
                workspaces.get(`${sessionId}:${id}`) ?? { following: false, milestones: 0 },
            ),
          ),
      ),
      saveWork: Effect.fn("MockProjects.saveWork")(
        ({ sessionId, id, work }: { sessionId: string; id: ProjectId; work: ProjectWork }) =>
          Ref.update(workspaces, (current) => new Map(current).set(`${sessionId}:${id}`, work)),
      ),
      brief: (id) =>
        Ref.get(briefs).pipe(
          Effect.map((briefs) =>
            Option.getOrElse(
              Option.fromUndefinedOr(briefs.get(id)),
              () => projectCatalog.find((project) => project.id === id)?.description ?? "",
            ),
          ),
        ),
      saveBrief: ({ id, brief }) =>
        Ref.update(briefs, (current) => new Map(current).set(id, brief)),
    });
  }),
);

export const mockResources = Layer.mergeAll(mockAuth, mockProjects);
