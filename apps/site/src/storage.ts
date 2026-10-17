import { Effect, Option } from "effect";

export const storageDiagnostic = () =>
  Effect.sync(() => console.warn("Browser storage unavailable; preferences may not persist."));

export const acquireStorage = Effect.fn("Storage.acquire")((acquire: () => Storage) =>
  Effect.try(acquire).pipe(
    Effect.map(Option.some),
    Effect.catch(() => storageDiagnostic().pipe(Effect.as(Option.none<Storage>()))),
  ),
);
