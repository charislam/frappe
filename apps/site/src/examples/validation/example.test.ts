import { Sync, component, mounting } from "@charismaticalli/frappe";
import { Effect, Exit, Match, Option, Scope } from "effect";
import { expect, it } from "vitest";
import { ValidationDemo } from "./example";

const until = (options: { parent: Node; check: () => boolean }) =>
  new Promise<void>((resolve) => {
    const observer = new MutationObserver(() => check());
    const check = () => {
      Match.value(options.check()).pipe(
        Match.when(true, () => {
          observer.disconnect();
          resolve();
        }),
        Match.orElse(() => {}),
      );
    };
    observer.observe(options.parent, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    check();
  });

it("shows inline errors on blur and committed edits, then checks the form on Continue", async () => {
  const scope = Effect.runSync(Scope.make());
  const parent = document.createElement("div");
  document.body.append(parent);
  const failures: unknown[] = [];
  const app = await Effect.runPromise(
    mounting({ scope, onError: (failure) => failures.push(failure) }),
  );
  Effect.runSync(
    app.h(
      parent,
      component(() =>
        Sync.succeed({ setup: (ctx) => ctx.he("main", { children: [ValidationDemo] }) }),
      ),
    ),
  );
  try {
    await until({ parent, check: () => parent.querySelectorAll("input").length === 4 });
    const field = (label: string) => {
      const element = Option.getOrThrow(
        Option.fromUndefinedOr(
          Array.from(parent.querySelectorAll("label")).find(
            (element) => element.textContent === label,
          ),
        ),
      );
      const container = Option.getOrThrow(Option.fromNullishOr(element.parentElement));
      const input = Option.getOrThrow(Option.fromNullishOr(container.querySelector("input")));
      const error = Option.getOrThrow(
        Option.fromNullishOr(container.querySelector<HTMLElement>('[aria-live="polite"]')),
      );
      return { input, error };
    };
    const name = field("Full name");
    const email = field("Work email");
    const password = field("Password");
    const team = field("Team size");
    const edit = (options: { input: HTMLInputElement; value: string }) => {
      options.input.value = options.value;
      options.input.dispatchEvent(
        new InputEvent("input", { bubbles: true, inputType: "insertFromPaste" }),
      );
    };
    expect(parent.querySelector("details, output")).toBeNull();
    expect(parent.querySelector('[aria-invalid="true"]')).toBeNull();
    expect(
      Array.from(parent.querySelectorAll<HTMLElement>('[aria-live="polite"]')).every(
        (error) => error.hidden,
      ),
    ).toBe(true);
    expect(
      Array.from(parent.querySelectorAll("button")).map((button) => button.textContent),
    ).toEqual(["Continue"]);
    expect(name.error.textContent).toBe("");
    expect(name.error.hidden).toBe(true);
    edit({ input: name.input, value: "   " });
    // A different field's blur provides a deterministic event queue barrier.
    email.input.dispatchEvent(new FocusEvent("blur"));
    await until({ parent, check: () => email.error.textContent !== "" });
    expect(name.input.getAttribute("aria-invalid")).toBe("false");
    expect(name.error.textContent).toBe("");
    expect(name.error.hidden).toBe(true);
    name.input.dispatchEvent(new FocusEvent("blur"));
    await until({ parent, check: () => name.input.getAttribute("aria-invalid") === "true" });
    expect(name.error.textContent).toBe("Enter your name to continue.");
    expect(name.error.hidden).toBe(false);
    expect(name.input.getAttribute("aria-describedby")).toContain(name.error.id);
    expect(password.input.getAttribute("aria-invalid")).toBe("false");
    expect(password.error.hidden).toBe(true);
    edit({ input: name.input, value: "  Alex Morgan  " });
    await until({ parent, check: () => name.input.getAttribute("aria-invalid") === "false" });
    expect(name.error.textContent).toBe("");
    expect(name.error.hidden).toBe(true);
    expect(name.input.value).toBe("  Alex Morgan  ");
    name.input.dispatchEvent(new CompositionEvent("compositionstart"));
    name.input.value = "";
    name.input.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true }));
    name.input.dispatchEvent(new FocusEvent("blur"));
    password.input.dispatchEvent(new FocusEvent("blur"));
    await until({ parent, check: () => password.error.textContent !== "" });
    expect(name.input.getAttribute("aria-invalid")).toBe("false");
    name.input.dispatchEvent(new CompositionEvent("compositionend"));
    await until({ parent, check: () => name.input.getAttribute("aria-invalid") === "true" });
    edit({ input: name.input, value: "Alex Morgan" });
    await until({ parent, check: () => name.input.getAttribute("aria-invalid") === "false" });

    const form = Option.getOrThrow(Option.fromNullishOr(parent.querySelector("form")));
    expect(form.noValidate).toBe(true);
    const submit = () =>
      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    expect(submit()).toBe(false);
    await until({ parent, check: () => team.input.getAttribute("aria-invalid") === "true" });
    expect(document.activeElement).toBe(email.input);
    expect(team.error.textContent).toContain("whole number");
    edit({ input: email.input, value: "alex@example.com" });
    edit({ input: password.input, value: "a secret password" });
    edit({ input: team.input, value: "0012" });
    submit();
    await until({
      parent,
      check: () =>
        parent.querySelector('[role="status"]')?.textContent?.includes("Your details look good") ===
        true,
    });
    expect(parent.querySelector('[aria-invalid="true"]')).toBeNull();
    expect(team.input.value).toBe("0012");
    expect(parent.textContent).not.toContain("a secret password");
    expect(
      Array.from(parent.querySelectorAll('[aria-live="polite"]')).every(
        (error) => error.textContent === "",
      ),
    ).toBe(true);
    edit({ input: email.input, value: "invalid" });
    await until({ parent, check: () => email.input.getAttribute("aria-invalid") === "true" });
    expect(parent.querySelector('[role="status"]')?.textContent).toBe("");
    expect(failures).toEqual([]);
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.void));
    parent.remove();
  }
});
