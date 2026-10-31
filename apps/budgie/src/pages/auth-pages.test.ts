// @vitest-environment happy-dom
import { Option } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { AuthError } from "~/auth/model";
import { cleanupAuthPages, harness } from "./auth-page-harness.test-helper";

afterEach(cleanupAuthPages);

describe("email-code authentication pages", () => {
  it("uses the same email-code flow for existing and new users", async () => {
    const h = await harness();
    await h.page("Sign in or create an account");
    expect(h.input("email").type).toBe("email");
    expect(h.root.querySelector('[name="password"]')).toBeNull();
    expect(h.button("Email me a code")).not.toBeNull();
    expect(
      Array.from(h.root.querySelectorAll("button")).some(
        (button) => button.textContent === "Continue with GitHub",
      ),
    ).toBe(false);
    expect(h.root.textContent).not.toContain("Forgot password?");
    h.input("email").value = "reader@example.com";
    h.button("Email me a code").click();
    await h.page("Check your email");
    expect(h.commands).toEqual([{ _tag: "RequestOtp", email: "reader@example.com" }]);
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

  it("sends and resends codes, then verifies them", async () => {
    const h = await harness({ initial: "/login", auth: Option.none() });
    await h.page("Sign in or create an account");
    h.input("email").value = "reader@example.com";
    h.button("Email me a code").click();
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
      { _tag: "RequestOtp", email: "reader@example.com" },
      { _tag: "RequestOtp", email: "reader@example.com" },
      { _tag: "VerifyOtp", email: "reader@example.com", code: "123456" },
    ]);
  });

  it("restores the email from a direct verification URL without sending a code", async () => {
    const h = await harness({
      initial: "/verify-code?email=restored%40example.com",
      auth: Option.none(),
    });
    await h.page("Check your email");
    expect(h.input("email").value).toBe("restored@example.com");
    expect(h.commands).toEqual([]);
    h.button("Resend code").click();
    await expect
      .poll(() => h.commands)
      .toEqual([{ _tag: "RequestOtp", email: "restored@example.com" }]);
  });

  it("keeps rejected code requests on the requesting page", async () => {
    const h = await harness({ initial: "/login", auth: Option.none() });
    await h.page("Sign in or create an account");
    h.input("email").value = "new@example.com";
    h.failNext(new AuthError({ kind: "rate-limit", message: "Wait before trying again." }));
    h.button("Email me a code").click();
    await expect
      .poll(() => h.root.querySelector('[role="alert"]')?.textContent)
      .toBe("Wait before trying again.");
    expect(h.history.location()).toBe("/login");
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
      .toEqual([{ _tag: "RequestOtp", email: "reader@example.com" }]);
  });
});

describe("email-code field validation", () => {
  it("validates email before requesting a code", async () => {
    const h = await harness({ initial: "/login", auth: Option.none() });
    await h.page("Sign in or create an account");
    h.input("email").value = "invalid";
    h.button("Email me a code").click();
    await expect.poll(() => h.input("email").getAttribute("aria-invalid")).toBe("true");
    expect(h.commands).toEqual([]);
    h.input("email").value = "reader@example.com";
    h.input("email").dispatchEvent(new InputEvent("input", { bubbles: true }));
    h.button("Email me a code").click();
    await h.page("Check your email");
    expect(h.commands).toEqual([{ _tag: "RequestOtp", email: "reader@example.com" }]);
  });
});
