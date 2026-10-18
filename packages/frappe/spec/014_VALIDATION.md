# frappé: signal validation

## Purpose and agreed scope

Add a headless validation primitive at the dedicated public entry point
`@charismaticalli/frappe/validation`, alongside `/query` and `/router`. Use Effect
Schema to decode input and expose a read-only signal containing exactly three
validation states. This document specifies future implementation; it does not
implement the module or demo.

Attach validation to an existing writable signal. Keep validation explicit in
the primitive: application code chooses when to call validate. Build an accessible
demo in `apps/site` with text, password, email, and numeric text inputs. The demo
validates on the first blur and on each subsequent edit.

Defer asynchronous validation, form orchestration, submission, cross-field rules,
remote checks, input filtering, and framework-owned touched/dirty state. The core
is generic over input and decoded output; the four example rules are application
schemas, not built-in field types or framework password policy.

## Public surface and state

Provide an attachment operation taking a named options object containing owner
context, source signal, and schema. Return a handle with a read-only `state`
signal and explicit `validate()`, `clearValidation()`, and `reset()` operations.
Names are provisional until the implementation type proof; these behaviors are
required. Operations follow existing frappe Effect and ReactiveError conventions.
Validation publishes its result into state; ordinary schema rejection is not an
operation failure. Return void from these operations rather than a separate result
that could disagree with the signal.

Infer the input type from the source and the output type from the schema. Check
compatibility with the schema's encoded input without casts. Preserve decoded
brands and transformations. Require a writable source because reset writes to it.

The structural state contract is:

```ts
import type { SchemaIssue } from "effect";

type ValidationState<Input, Value> =
  | { readonly _tag: "NotValidated"; readonly input: Input }
  | { readonly _tag: "Validated"; readonly input: Input; readonly value: Value }
  | { readonly _tag: "Invalid"; readonly input: Input; readonly issue: SchemaIssue.Issue };
```

`issue` retains the complete structured issue tree, including paths and nested
failures. A single tree can contain multiple issues. Only Validated exposes a
decoded value. Do not retain previous successful values or stale errors in other
variants. Derive the view from one authoritative validation state; do not expose
independently writable valid/value/error signals.

Use Effect tagged data for the state algebra and exhaustive matching consistent
with repository conventions. Effect Schema validates the input; the state itself
does not need a serializable schema. Supply narrowing guards and an exhaustive
state match helper with inferred handler parameters. Export the state type and
helpers through the validation entry point, keeping implementation modules small.

## State transitions

Every attachment starts NotValidated, even when its prefilled input satisfies the
schema. Capture the original input at attachment for reset. Do not validate during
attachment, source changes, clear, or reset.

| Event                        | Previous state | Result                                             |
| ---------------------------- | -------------- | -------------------------------------------------- |
| Explicit validation succeeds | Any            | Validated with current input and decoded value     |
| Explicit validation rejects  | Any            | Invalid with current input and complete issue tree |
| Source changes               | Any            | NotValidated with new input                        |
| Clear validation             | Any            | NotValidated with current input; source unchanged  |
| Reset                        | Any            | Restore original input and clear validation        |

Reset always clears validation, including when the source already equals its
original value. Do not provide an option to retain a validation result across
reset. Clear can be called independently without restoring input. Repeated clear
or reset is safe. Explicit validation reruns the schema even for unchanged input.

Source equality follows the existing signal's equality contract. An equal write
does not count as an edit. Treat generic source values as immutable under existing
signal conventions; reset retains the original value rather than deep-cloning
arbitrary objects.

## Transactions and ownership

Invalidate validation synchronously with a source change, for both DOM edits and
programmatic writes. An asynchronous changes-stream subscription alone is not
sufficient: observers must never see new input paired with old validation.

Compose with existing reactive transactions. Within a batch, validate reads the
current staged input. Set then validate commits the validation for that input;
validate then set a different input commits NotValidated. Failed batches publish
neither staged input nor staged validation. Changes coalesced to the original
input without an intervening explicit validation follow existing signal equality
and commit semantics. Reset restores input and clears validation atomically.

When an application validates an edit in the same transaction, observers may see
the final Validated or Invalid state directly. The intermediate NotValidated
state need not produce a separate DOM paint. This preserves immediate invalidation
without requiring flicker in the demo's subsequent-edit validation.

Owner context establishes lifetime. Reject foreign-runtime sources and illegal
source lifetimes using existing ownership rules. Disposing the handle's owner
releases internal reactive work; later operations fail under existing disposed
owner conventions. The attachment does not own or dispose the supplied source.
Two attachments to the same source keep independent validation results; an edit
invalidates both. Clearing one does not clear the other, while resetting one
changes their shared input and therefore invalidates the other when unequal.

## Schema execution and errors

Support synchronous, self-contained schema decoding only in v1. Use the pinned
Effect v4 APIs and confirm against the installed source and read-only vendored
reference before implementation. The current reference offers result-based
decoding, structured SchemaIssue trees, and the parse option `errors: "all"`.
Collect all issues the schema can report, respecting decoding dependencies: a
failed prerequisite transformation cannot produce downstream validation results.

Do not use a throwing decoder for ordinary invalid input. Keep schema mismatches
in Invalid; programming defects and unsupported asynchronous execution must not
be converted into user validation errors. Reject schemas with required decoder
services at the type boundary. Because types may not prove that a self-contained
schema is synchronous, also test and document runtime rejection of an async
schema. Such rejection must not publish Validated or a misleading Invalid state.

Provide a pure formatting helper over the issue tree that produces displayable
messages while preserving paths. Use Effect's formatter facilities where suitable;
do not discard structure in the state or force one combined string. Applications
own labels, localization, and placement. Demo messages must not echo password
input or include it in diagnostic output.

Normalization changes only the decoded value. Validation never writes a trimmed,
parsed, lowercased, or otherwise normalized value back to the source or DOM.

## Example schemas

These fixtures make behavior concrete and remain application choices.

| Input          | DOM type | Schema behavior                                                                                                      |
| -------------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| Text           | text     | Trim surrounding whitespace; require a nonempty decoded string                                                       |
| Password       | password | Require at least eight characters; preserve whitespace and case                                                      |
| Email          | email    | Trim surrounding whitespace; validate with an explicitly selected Effect Schema-compatible email rule; preserve case |
| Natural number | text     | Trim surrounding whitespace, accept ASCII digits only, decode to a nonnegative safe integer                          |

The password minimum of eight is a demo fixture, measured using the chosen
schema string-length semantics; document those semantics in the tests. Do not
add composition or complexity requirements. Email validation checks format only,
not mailbox existence. Select and document its exact rule during implementation;
do not depend on browser constraint validation to determine framework state.

The numeric input accepts arbitrary edits and paste, then reports invalid input.
Use `type="text"` with `inputmode="numeric"` as a keyboard hint, without filtering.
Zero and leading zeros are allowed. Only surrounding whitespace is ignored;
embedded whitespace is invalid. Reject signs, decimals, exponent notation,
separators, non-ASCII digits, empty strings, and values outside
`0..Number.MAX_SAFE_INTEGER`. Do not accept partial parses or precision loss.

| Raw numeric input                                | Result                                  |
| ------------------------------------------------ | --------------------------------------- |
| `0`, `000`                                       | Validated, value 0                      |
| `0012`                                           | Validated, value 12; raw text unchanged |
| `9007199254740991`                               | Validated, maximum safe integer         |
| `9007199254740992` or larger                     | Invalid                                 |
| empty or whitespace-only                         | Invalid                                 |
| `-1`, `+1`, `1.0`, `1.`, `1e3`, `1E3`            | Invalid                                 |
| `1 2`, `1,000`, `12abc`, non-ASCII digit strings | Invalid                                 |

## Site demo and accessibility

Add a discoverable demo to `apps/site` using existing component, signal, binding,
and styling conventions. Each field has its own source and validation attachment.
Show its validation state and, where appropriate, decoded output. Never display
the password's raw or decoded value as demo diagnostics.

Keep a separate application-owned per-field flag recording whether the first blur
has occurred. Before that blur, edits leave the field NotValidated and do not run
validation. The first blur sets the flag and explicitly calls validate. Subsequent
edits explicitly validate the updated source; later blurs may validate again.
This policy belongs to the demo, not an automatic trigger in the primitive.

Use the established bindValue and event transaction behavior so validation reads
the updated signal, not a stale event snapshot. Preserve existing IME semantics:
do not validate intermediate composition text; validate the committed composition
value when subsequent-edit validation is active. Resolve and test blur during
composition so the final committed text receives the requested validation.

Provide separate clear-validation and reset controls. Clearing validation leaves
the demo's first-blur flag intact, so the next edit revalidates. Demo reset also
clears that flag, restoring the first-blur policy, in addition to calling the
primitive's reset. The primitive itself does not track blur history.

Use visible labels associated with inputs, stable error element IDs, and
`aria-describedby` connections to help/error text. Set `aria-invalid="true"`
only in Invalid; omit it or set false otherwise. Show errors after validation,
clear stale errors on invalidation/clear/reset, and announce updated errors
politely without moving focus. All controls must work with the keyboard. Native
email validation must not intercept the demo's validation flow.

## Acceptance tests and implementation sequence

1. Prove the entry point and generic inference: input/output compatibility,
   transformed and branded values, read-only state, exhaustive matching, and
   rejection of service-requiring schemas. Prove synchronous execution behavior.
2. Implement and test all transitions from each state, initial prefilled values,
   repeated validation, clear versus reset, and equal writes. Validate that schema
   rejection becomes Invalid and that defects are not treated as field errors.
3. Test atomic edits, staged reads, set/validate ordering, rollback, reset, multiple
   attachments, source lifetime restrictions, and disposal without sleep-based
   synchronization. Ensure stale errors and decoded values cannot reappear.
4. Test all four example schemas, including empty values, whitespace, password
   length boundaries, valid/invalid email fixtures, numeric boundaries above,
   and raw-versus-decoded preservation. Include a schema with multiple independent
   failing fields to prove all issues and paths survive formatting.
5. Add DOM integration coverage and the site demo. Verify first-blur validation,
   no pre-blur validation, subsequent-edit validation, paste, composition, clear,
   reset, and accessibility attributes. Check that one field's blur does not arm
   another field and that password values are absent from diagnostics.
6. Document the public entry point and demo. During implementation run focused
   runtime/type tests, `pnpm fmt`, `pnpm lint`, and `pnpm typecheck`; report any
   unrelated baseline failures. Do not modify vendored repositories.

There is no pending validation state, background validation task, debounce policy,
or server dependency in this version.
