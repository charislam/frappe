// @vitest-environment happy-dom
import { Deferred, Effect, Option } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { AuthError, type AuthState } from "~/auth/model";
import { cleanupAuthPages, harness } from "./auth-page-harness.test-helper";

const run = Effect.runPromise;
afterEach(cleanupAuthPages);

describe("separate authentication pages", () => {
  it("starts with email and reveals password sign-in without losing the email", async () => {
    const h = await harness();
    await h.page("Sign in");
    expect(h.input("password").disabled).toBe(true);
    expect(h.input("password").closest("label")?.hidden).toBe(true);
    expect(h.button("Sign in").hidden).toBe(true);
    expect(h.button("Email me a sign-in code").hidden).toBe(false);
    h.input("email").value = "reader@example.com";
    h.button("Use Password").click();
    await expect.poll(() => h.input("password").disabled).toBe(false);
    expect(h.input("email").value).toBe("reader@example.com");
    expect(h.input("password").closest("label")?.hidden).toBe(false);
    expect(h.button("Sign in").hidden).toBe(false);
    expect(h.button("Use Password").hidden).toBe(true);
    expect(h.button("Email me a sign-in code").hidden).toBe(true);
    h.submit();
    await expect.poll(() => h.input("password").getAttribute("aria-invalid")).toBe("true");
    expect(h.commands).toEqual([]);
  });
  it("submits the email-only form as a code request", async () => {
    const h = await harness();
    await h.page("Sign in");
    h.input("email").value = "reader@example.com";
    h.submit();
    await h.page("Check your email");
    expect(h.commands).toEqual([
      { _tag: "RequestOtp", email: "reader@example.com", intent: "signin" },
    ]);
  });
  it.each([
    { path: "/verify-code", heading: "Check your email" },
    { path: "/signup/confirmation", heading: "Confirm your email" },
  ])("locks query-provided email on $path", async ({ path, heading }) => {
    const h = await harness({
      initial: `${path}?email=reader%40example.com`,
      auth: Option.none(),
    });
    await h.page(heading);
    expect(h.input("email").value).toBe("reader@example.com");
    expect(h.input("email").readOnly).toBe(true);
    expect(h.input("email").disabled).toBe(false);
  });
  it("password login submits only credentials, prevents duplicates, and exposes errors", async () => {
    const h = await harness();
    await h.page("Sign in");
    h.input("email").value = "reader@example.com";
    h.button("Use Password").click();
    await expect.poll(() => h.input("password").disabled).toBe(false);
    h.input("password").value = "password123";
    const completion = h.holdNext();
    h.failNext(new AuthError({ kind: "credentials", message: "Email or password is incorrect." }));
    h.submit();
    await expect.poll(() => h.root.querySelector("fieldset")?.disabled).toBe(true);
    h.submit();
    await run(Deferred.succeed(completion, undefined));
    await expect
      .poll(() => h.root.querySelector('[role="alert"]')?.textContent)
      .toBe("Email or password is incorrect.");
    expect(h.commands).toEqual([
      { _tag: "Password", credentials: { email: "reader@example.com", password: "password123" } },
    ]);
    expect(h.history.location()).toBe("/login");
  });
  it("clears previous errors and success messages when a new submission is pending", async () => {
    const h = await harness({ initial: "/forgot-password", auth: Option.none() });
    await expect.poll(() => h.root.querySelector('input[name="email"]')).not.toBeNull();
    h.input("email").value = "reader@example.com";
    h.failNext(new AuthError({ kind: "transport", message: "Offline" }));
    h.submit();
    await expect.poll(() => h.root.querySelector('[role="alert"]')?.textContent).toBe("Offline");
    const retry = h.holdNext();
    h.submit();
    await expect.poll(() => h.root.querySelector("fieldset")?.disabled).toBe(true);
    expect(h.root.querySelector('[role="alert"]')?.textContent).toBe("");
    expect(h.root.querySelector('[role="status"]')?.textContent).toBe("");
    await run(Deferred.succeed(retry, undefined));
    await expect.poll(() => h.root.querySelector("fieldset")?.disabled).toBe(false);
    await expect.poll(() => h.root.querySelector('[role="status"]')?.textContent).not.toBe("");
    const again = h.holdNext();
    h.submit();
    await expect.poll(() => h.root.querySelector("fieldset")?.disabled).toBe(true);
    expect(h.root.querySelector('[role="status"]')?.textContent).toBe("");
    await run(Deferred.succeed(again, undefined));
    await expect.poll(() => h.root.querySelector("fieldset")?.disabled).toBe(false);
  });
  it("takes signup without a session to its own confirmation page and resends there", async () => {
    const h = await harness({ initial: "/signup", auth: Option.none() });
    await h.page("Create your account");
    h.input("email").value = "new@example.com";
    h.input("password").value = "password123";
    h.submit();
    await h.page("Confirm your email");
    expect(h.history.location()).toBe("/signup/confirmation?email=new%40example.com");
    expect(h.input("email").value).toBe("new@example.com");
    expect(h.root.querySelector('[name="password"]')).toBeNull();
    h.submit();
    await expect
      .poll(() => h.root.querySelector('[role="status"]')?.textContent)
      .toContain("Confirmation sent");
    expect(h.commands).toEqual([
      { _tag: "Signup", credentials: { email: "new@example.com", password: "password123" } },
      { _tag: "ResendConfirmation", email: "new@example.com" },
    ]);
  });
  it.each([
    {
      start: "/login",
      heading: "Sign in",
      button: "Email me a sign-in code",
      intent: "signin",
    },
    {
      start: "/signup",
      heading: "Create your account",
      button: "Sign up with an email code",
      intent: "signup",
    },
  ] as const)(
    "sends a $intent code and verifies/resends on its own page",
    async ({ start, heading, button, intent }) => {
      const h = await harness({ initial: start, auth: Option.none() });
      await h.page(heading);
      h.input("email").value = "reader@example.com";
      h.button(button).click();
      await h.page("Check your email");
      expect(h.history.location()).toContain("/verify-code?");
      expect(h.input("email").value).toBe("reader@example.com");
      expect(h.input("code").autocomplete).toBe("one-time-code");
      h.button("Resend code").click();
      await expect.poll(() => h.commands.length).toBe(2);
      h.failNext(
        new AuthError({
          kind: "code",
          message: "This code is invalid or expired. Request a new code.",
        }),
      );
      h.input("code").value = "123456";
      h.submit();
      await expect
        .poll(() => h.root.querySelector('[role="alert"]')?.textContent)
        .toContain("invalid or expired");
      expect(h.commands).toEqual([
        { _tag: "RequestOtp", email: "reader@example.com", intent },
        { _tag: "RequestOtp", email: "reader@example.com", intent },
        { _tag: "VerifyOtp", email: "reader@example.com", code: "123456" },
      ]);
    },
  );
  it("restores verification intent and email from a direct URL without sending a code", async () => {
    const h = await harness({
      initial: "/verify-code?email=restored%40example.com&intent=signup",
      auth: Option.none(),
    });
    await h.page("Check your email");
    expect(h.input("email").value).toBe("restored@example.com");
    expect(h.commands).toEqual([]);
    h.button("Resend code").click();
    await expect
      .poll(() => h.commands)
      .toEqual([{ _tag: "RequestOtp", email: "restored@example.com", intent: "signup" }]);
  });
  it("keeps rejected signup and code requests on the requesting page", async () => {
    const h = await harness({ initial: "/signup", auth: Option.none() });
    await h.page("Create your account");
    h.input("email").value = "new@example.com";
    h.input("password").value = "password123";
    h.failNext(new AuthError({ kind: "rate-limit", message: "Wait before trying again." }));
    h.submit();
    await expect
      .poll(() => h.root.querySelector('[role="alert"]')?.textContent)
      .toBe("Wait before trying again.");
    expect(h.history.location()).toBe("/signup");
    h.failNext(new AuthError({ kind: "transport", message: "Authentication is unavailable." }));
    h.button("Sign up with an email code").click();
    await expect
      .poll(() => h.root.querySelector('[role="alert"]')?.textContent)
      .toBe("Authentication is unavailable.");
    expect(h.history.location()).toBe("/signup");
    expect(h.failures).toEqual([]);
  });
  it("allows email entry on verification when the URL has no email parameter", async () => {
    const h = await harness({ initial: "/verify-code", auth: Option.none() });
    await h.page("Check your email");
    expect(h.input("email").value).toBe("");
    expect(h.input("email").readOnly).toBe(false);
    expect(h.input("email").required).toBe(true);
    expect(h.commands).toEqual([]);
    h.input("email").value = "reader@example.com";
    h.button("Resend code").click();
    await expect
      .poll(() => h.commands)
      .toEqual([{ _tag: "RequestOtp", email: "reader@example.com", intent: "signin" }]);
  });
  it("allows email entry on confirmation without an email parameter and links to recovery", async () => {
    const h = await harness({ initial: "/signup/confirmation", auth: Option.none() });
    await h.page("Confirm your email");
    expect(h.input("email").value).toBe("");
    expect(h.input("email").readOnly).toBe(false);
    expect(h.commands).toEqual([]);
    await h.follow("Back to sign in");
    await h.page("Sign in");
    await h.follow("Forgot password?");
    await h.page("Forgot your password?");
    h.input("email").value = "reader@example.com";
    h.submit();
    await expect
      .poll(() => h.root.querySelector('[role="status"]')?.textContent)
      .toContain("If an account exists");
    expect(h.history.location()).toBe("/forgot-password");
    expect(h.commands).toEqual([{ _tag: "RequestRecovery", email: "reader@example.com" }]);
  });
});

const authenticated: AuthState = {
  _tag: "Ready",
  user: Option.some({ id: "A", email: Option.some("reader@example.com") }),
};
describe("page-local password recovery", () => {
  it("accepts an authenticated reset route and completes only after a successful password update", async () => {
    const h = await harness({ initial: "/reset-password", auth: Option.some(authenticated) });
    await h.page("Choose a new password");
    expect(h.button("Continue to accounts").hidden).toBe(true);
    h.input("password").value = "new-password123";
    h.input("confirmation").value = "different-password";
    h.submit();
    await expect
      .poll(() => h.root.querySelector('[role="alert"]')?.textContent)
      .toBe("Passwords must match.");
    expect(h.commands).toEqual([]);
    h.input("confirmation").value = "new-password123";
    h.failNext(new AuthError({ kind: "transport", message: "Unable to save password." }));
    h.submit();
    await expect
      .poll(() => h.root.querySelector('[role="alert"]')?.textContent)
      .toBe("Unable to save password.");
    expect(h.button("Continue to accounts").hidden).toBe(true);
    expect(h.history.location()).toBe("/reset-password");
    h.submit();
    await expect.poll(() => h.button("Continue to accounts").hidden).toBe(false);
    expect(h.history.location()).toBe("/reset-password");
    await expect
      .poll(() => h.root.querySelector('[role="status"]')?.textContent)
      .toContain("Your password has been updated");
    h.button("Continue to accounts").click();
    await h.page("Accounts");
    expect(h.history.location()).toBe("/accounts");
    expect(h.failures).toEqual([]);
  });
  it("lets users retry a failed continuation without updating the password again", async () => {
    const h = await harness({ initial: "/reset-password", auth: Option.some(authenticated) });
    await h.page("Choose a new password");
    h.input("password").value = "new-password123";
    h.input("confirmation").value = "new-password123";
    h.submit();
    await expect.poll(() => h.button("Continue to accounts").hidden).toBe(false);
    h.history.failNextWrite("History write denied");
    h.button("Continue to accounts").click();
    await expect
      .poll(() => h.root.querySelector('[role="alert"]')?.textContent)
      .toBe("Unable to open the next page. Please try again.");
    expect(h.history.location()).toBe("/reset-password");
    expect(h.button("Continue to accounts").hidden).toBe(false);
    h.button("Continue to accounts").click();
    await h.page("Accounts");
    expect(h.commands).toEqual([{ _tag: "UpdatePassword", password: "new-password123" }]);
    expect(h.failures).toEqual([]);
  });
  it("keeps completion through same-user refresh and resets it when the account changes", async () => {
    const h = await harness({ initial: "/reset-password", auth: Option.some(authenticated) });
    await h.page("Choose a new password");
    h.input("password").value = "new-password123";
    h.input("confirmation").value = "new-password123";
    h.submit();
    await expect.poll(() => h.button("Continue to accounts").hidden).toBe(false);
    await h.publish(authenticated);
    await h.publish({ _tag: "Ready", user: Option.some({ id: "B", email: Option.none() }) });
    await expect.poll(() => h.button("Continue to accounts").hidden).toBe(true);
    expect(h.input("password").value).toBe("");
    expect(h.input("confirmation").value).toBe("");
    expect(h.failures).toEqual([]);
  });
  it("does not treat URL parameters as authentication", async () => {
    const h = await harness({
      initial: "/reset-password?recovery=true&complete=true",
      auth: Option.none(),
    });
    await h.page("Sign in");
    expect(h.history.location()).toBe("/login");
    expect(h.commands).toEqual([]);
  });
});

describe("frappe field validation", () => {
  it("blocks invalid signup fields, shows inline errors, and validates edits", async () => {
    const h = await harness({ initial: "/signup", auth: Option.none() });
    await h.page("Create your account");
    h.input("email").value = "invalid";
    h.input("password").value = "short";
    h.submit();
    await expect.poll(() => h.root.querySelectorAll('[aria-invalid="true"]').length).toBe(2);
    expect(h.commands).toEqual([]);
    expect(h.root.textContent).toContain("Enter a valid email address.");
    expect(h.root.textContent).toContain("Use at least 8 characters");
    expect(document.activeElement).toBe(h.input("email"));
    h.input("email").value = "  reader@example.com  ";
    h.input("email").dispatchEvent(new InputEvent("input", { bubbles: true }));
    h.input("password").value = " password123 ";
    h.input("password").dispatchEvent(new InputEvent("input", { bubbles: true }));
    await expect.poll(() => h.root.querySelectorAll('[aria-invalid="true"]').length).toBe(0);
    h.submit();
    await h.page("Confirm your email");
    expect(h.commands).toEqual([
      { _tag: "Signup", credentials: { email: "reader@example.com", password: " password123 " } },
    ]);
  });
  it("validates email-code requests without requiring a password", async () => {
    const h = await harness();
    await h.page("Sign in");
    h.input("email").value = "invalid";
    h.button("Email me a sign-in code").click();
    await expect.poll(() => h.input("email").getAttribute("aria-invalid")).toBe("true");
    expect(h.input("password").getAttribute("aria-invalid")).toBe("false");
    expect(h.commands).toEqual([]);
    h.input("email").value = "reader@example.com";
    h.button("Email me a sign-in code").click();
    await h.page("Check your email");
    expect(h.commands).toEqual([
      { _tag: "RequestOtp", email: "reader@example.com", intent: "signin" },
    ]);
  });
  it("validates reset passwords before sending an update", async () => {
    const h = await harness({
      initial: "/reset-password",
      auth: Option.some({ _tag: "Ready", user: Option.some({ id: "A", email: Option.none() }) }),
    });
    await h.page("Choose a new password");
    h.input("password").value = "short";
    h.input("confirmation").value = "short";
    h.submit();
    await expect.poll(() => h.root.querySelectorAll('[aria-invalid="true"]').length).toBe(2);
    expect(h.commands).toEqual([]);
  });
});
