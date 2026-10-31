// @vitest-environment happy-dom
import { Option } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { AuthError } from "~/auth/model";
import { cleanupAuthPages, harness } from "./auth-page-harness.test-helper";

afterEach(cleanupAuthPages);

describe("email-code authentication pages", () => {
  it("offers only email-code sign-in", async () => {
    const h = await harness();
    await h.page("Sign in");
    expect(h.input("email").type).toBe("email");
    expect(h.root.querySelector('[name="password"]')).toBeNull();
    expect(h.button("Email me a sign-in code")).not.toBeNull();
    expect(
      Array.from(h.root.querySelectorAll("button")).some(
        (button) => button.textContent === "Continue with GitHub",
      ),
    ).toBe(false);
    expect(h.root.textContent).not.toContain("Forgot password?");
    h.input("email").value = "reader@example.com";
    h.button("Email me a sign-in code").click();
    await h.page("Check your email");
    expect(h.commands).toEqual([
      { _tag: "RequestOtp", email: "reader@example.com", intent: "signin" },
    ]);
  });

  it("offers email-code signup without password or confirmation screens", async () => {
    const h = await harness({ initial: "/signup", auth: Option.none() });
    await h.page("Create your account");
    expect(h.root.querySelector('[name="password"]')).toBeNull();
    expect(
      Array.from(h.root.querySelectorAll("button")).some(
        (button) => button.textContent === "Create account",
      ),
    ).toBe(false);
    h.input("email").value = "new@example.com";
    h.button("Sign up with an email code").click();
    await h.page("Check your email");
    expect(h.history.location()).toContain("/verify-code?");
    expect(h.history.location()).toContain("intent=signup");
    expect(h.commands).toEqual([
      { _tag: "RequestOtp", email: "new@example.com", intent: "signup" },
    ]);
  });

  it("locks a query-provided email on verification", async () => {
    const h = await harness({
      initial: "/verify-code?email=reader%40example.com",
      auth: Option.none(),
    });
    await h.page("Check your email");
    expect(h.input("email").value).toBe("reader@example.com");
    expect(h.input("email").readOnly).toBe(true);
    expect(h.input("email").disabled).toBe(false);
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

  it("keeps rejected sign-up code requests on the requesting page", async () => {
    const h = await harness({ initial: "/signup", auth: Option.none() });
    await h.page("Create your account");
    h.input("email").value = "new@example.com";
    h.failNext(new AuthError({ kind: "rate-limit", message: "Wait before trying again." }));
    h.button("Sign up with an email code").click();
    await expect
      .poll(() => h.root.querySelector('[role="alert"]')?.textContent)
      .toBe("Wait before trying again.");
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
});

describe("email-code field validation", () => {
  it("validates email before requesting a code", async () => {
    const h = await harness({ initial: "/signup", auth: Option.none() });
    await h.page("Create your account");
    h.input("email").value = "invalid";
    h.button("Sign up with an email code").click();
    await expect.poll(() => h.input("email").getAttribute("aria-invalid")).toBe("true");
    expect(h.commands).toEqual([]);
    h.input("email").value = "reader@example.com";
    h.input("email").dispatchEvent(new InputEvent("input", { bubbles: true }));
    h.button("Sign up with an email code").click();
    await h.page("Check your email");
    expect(h.commands).toEqual([
      { _tag: "RequestOtp", email: "reader@example.com", intent: "signup" },
    ]);
  });
});
