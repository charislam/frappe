import { Data, Match, Option, Result, Schema } from "effect";

/** Use clear to suppress inheritance and fallbacks; omitted fields inherit. */
export type Field<A> = A | Clear;
type Instruction<A> = Data.TaggedEnum<{
  Inherit: {};
  Set: { readonly value: A };
  Clear: {};
}>;
const Instruction = Data.taggedEnum<Instruction<unknown>>();
export type Clear = Extract<Instruction<never>, { readonly _tag: "Clear" }>;
/** Explicitly suppress an inherited metadata field and its automatic fallbacks. */
export const clear: Clear = Instruction.Clear();
const instruction = <A>(value: Field<A> | undefined): Instruction<A> =>
  Match.value(value).pipe(
    Match.when(undefined, () => Instruction.Inherit()),
    Match.when(
      (value: Field<A>): value is Clear => value === clear,
      () => clear,
    ),
    Match.orElse((value) => ({ _tag: "Set" as const, value })),
  );
export interface Image {
  readonly url: string;
  readonly alt?: string;
  readonly width?: number;
  readonly height?: number;
}
export interface Metadata {
  readonly title?: Field<string>;
  /** Exactly one %s placeholder, applied once after inheritance. */
  readonly titleTemplate?: Field<string>;
  readonly description?: Field<string>;
  /** URLs must be absolute unless root.siteUrl is configured; never inferred from location. */
  readonly canonical?: Field<string>;
  readonly robots?: Field<string>;
  readonly openGraph?: {
    readonly title?: Field<string>;
    readonly description?: Field<string>;
    readonly url?: Field<string>;
    readonly type?: Field<string>;
    readonly siteName?: Field<string>;
    /** Replaces the inherited array; no canonical or image URL fallbacks are implicit. */
    readonly images?: Field<ReadonlyArray<Image>>;
  };
  readonly twitter?: {
    readonly card?: Field<string>;
    readonly title?: Field<string>;
    readonly description?: Field<string>;
    /** No automatic Open Graph image fallback. */
    readonly image?: Field<string>;
    readonly site?: Field<string>;
  };
}
export interface Tag {
  readonly key: string;
  readonly element: "meta" | "link" | "title";
  readonly text?: string;
  readonly attributes: Readonly<Record<string, string>>;
}
export interface Snapshot {
  readonly title: Option.Option<string>;
  readonly tags: ReadonlyArray<Tag>;
}
export class MetadataError extends Schema.TaggedError<MetadataError>()("MetadataError", {
  message: Schema.String,
}) {}

export const resolve = (options: {
  chain: ReadonlyArray<Metadata>;
  siteUrl?: string;
}): Result.Result<Snapshot, MetadataError> =>
  Result.gen(function* () {
    const siteUrl = yield* Result.try({
      try: () => Option.map(Option.fromUndefinedOr(options.siteUrl), (base) => new URL(base)),
      catch: () => new MetadataError({ message: "siteUrl must be an absolute URL" }),
    });
    const merged = options.chain.reduce<Metadata>(
      (parent, child) => ({
        ...parent,
        ...child,
        openGraph: { ...parent.openGraph, ...child.openGraph },
        twitter: { ...parent.twitter, ...child.twitter },
      }),
      {},
    );
    const urls = new Map<string, string>();
    const inputs = [
      merged.canonical,
      merged.openGraph?.url,
      merged.twitter?.image,
      ...Match.value(merged.openGraph?.images).pipe(
        Match.when(
          (value: Field<ReadonlyArray<Image>> | undefined): value is ReadonlyArray<Image> =>
            Array.isArray(value),
          (images) => images.map((image) => image.url),
        ),
        Match.orElse(() => []),
      ),
    ];
    for (const value of inputs) {
      yield* Match.value(value).pipe(
        Match.when(
          (value: Field<string> | undefined): value is string => typeof value === "string",
          (value) =>
            Result.try({
              try: () => {
                urls.set(
                  value,
                  Option.match(siteUrl, {
                    onNone: () => new URL(value).href,
                    onSome: (base) => new URL(value, base).href,
                  }),
                );
              },
              catch: () =>
                new MetadataError({
                  message: `Invalid metadata URL: ${value}; relative URLs require siteUrl`,
                }),
            }),
        ),
        Match.orElse(() => Result.succeed(undefined)),
      );
    }
    const url = (value: string) =>
      Option.getOrElse(Option.fromUndefinedOr(urls.get(value)), () => value);
    const fallback = <A>(
      value: Field<A> | undefined,
      inherited: Option.Option<A>,
    ): Option.Option<A> =>
      Match.value(instruction(value)).pipe(
        Match.tag("Inherit", () => inherited),
        Match.tag("Clear", () => Option.none<A>()),
        Match.tag("Set", ({ value }) => Option.some(value)),
        Match.exhaustive,
      );
    const present = <A>(value: Field<A> | undefined): Option.Option<A> =>
      fallback(value, Option.none());
    let title = present(merged.title);
    yield* Option.match(present(merged.titleTemplate), {
      onNone: () => Result.succeed(undefined),
      onSome: (template) =>
        Match.value(template.split("%s").length === 2).pipe(
          Match.when(false, () =>
            Result.fail(new MetadataError({ message: "titleTemplate requires exactly one %s" })),
          ),
          Match.when(true, () => {
            title = Option.map(title, (value) => template.replace("%s", value));
            return Result.succeed(undefined);
          }),
          Match.exhaustive,
        ),
    });
    const tags: Tag[] = [];
    const meta = (key: string, value: Option.Option<string>, property = false) =>
      Option.match(value, {
        onNone: () => {},
        onSome: (content) => {
          tags.push({
            key,
            element: "meta",
            attributes: { [property ? "property" : "name"]: key, content },
          });
        },
      });
    meta("description", present(merged.description));
    meta("robots", present(merged.robots));
    Option.map(present(merged.canonical), (value) =>
      tags.push({
        key: "canonical",
        element: "link",
        attributes: { rel: "canonical", href: url(value) },
      }),
    );
    const og = merged.openGraph ?? {};
    const twitter = merged.twitter ?? {};
    const ogTitle = fallback(og.title, title);
    const ogDescription = fallback(og.description, present(merged.description));
    meta("og:title", ogTitle, true);
    meta("og:description", ogDescription, true);
    meta("og:url", Option.map(present(og.url), url), true);
    meta("og:type", present(og.type), true);
    meta("og:site_name", present(og.siteName), true);
    for (const [index, image] of Option.getOrElse(present(og.images), () => []).entries()) {
      for (const [suffix, value] of Object.entries({
        "": url(image.url),
        ":alt": image.alt,
        ":width": image.width,
        ":height": image.height,
      })) {
        Option.map(present(value), (content) =>
          tags.push({
            key: `og:image:${index}${suffix}`,
            element: "meta",
            attributes: { property: `og:image${suffix}`, content: String(content) },
          }),
        );
      }
    }
    meta("twitter:card", present(twitter.card));
    meta("twitter:title", fallback(twitter.title, ogTitle));
    meta("twitter:description", fallback(twitter.description, ogDescription));
    meta("twitter:image", Option.map(present(twitter.image), url));
    meta("twitter:site", present(twitter.site));
    return { title, tags };
  });
