// @vitest-environment happy-dom
import { Deferred, Effect, Option } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { AuthError } from "~/auth/model";
import { cleanupAuthPages, harness } from "./auth-page-harness.test-helper";

const run = Effect.runPromise;
afterEach(cleanupAuthPages);

describe("email-code authentication", () => {
  it("offers only email-code sign-in and explains automatic account creation", async () => {
    const h = await harness();
    await h.page("Sign in");
    expect(h.root.querySelectorAll("input")).toHaveLength(1);
    expect(h.root.textContent).toContain("create your account automatically");
    expect(h.root.textContent).not.toMatch(/GitHub|Password|Forgot password|Create an account/);
    h.input("email").value = "new@example.com";
    h.button("Email me a sign-in code").click();
    await h.page("Check your email");
    expect(h.history.location()).toBe("/verify-code?email=new%40example.com");
    expect(h.commands).toEqual([{ _tag: "RequestOtp", email: "new@example.com" }]);
  });
  it("validates and trims email before submitting with Enter", async () => {
    const h = await harness();
    await h.page("Sign in");
    h.input("email").value = "invalid";
    h.submit();
    await expect.poll(() => h.input("email").getAttribute("aria-invalid")).toBe("true");
    expect(h.commands).toEqual([]);
    expect(document.activeElement).toBe(h.input("email"));
    h.input("email").value = "  reader@example.com  ";
    h.input("email").dispatchEvent(new InputEvent("input", { bubbles: true }));
    await expect.poll(() => h.input("email").getAttribute("aria-invalid")).toBe("false");
    h.submit();
    await h.page("Check your email");
    expect(h.commands).toEqual([{ _tag: "RequestOtp", email: "reader@example.com" }]);
  });
  it("prevents duplicate requests, keeps failures on login, and clears errors on retry", async () => {
    const h = await harness();
    await h.page("Sign in");
    h.input("email").value = "reader@example.com";
    const completion = h.holdNext();
    h.failNext(new AuthError({ kind: "transport", message: "Offline" }));
    h.submit();
    await expect.poll(() => h.root.querySelector("fieldset")?.disabled).toBe(true);
    h.submit();
    await run(Deferred.succeed(completion, undefined));
    await expect.poll(() => h.root.querySelector('[role="alert"]')?.textContent).toBe("Offline");
    expect(h.commands).toHaveLength(1);
    expect(h.history.location()).toBe("/login");
    const retry = h.holdNext();
    h.submit();
    await expect.poll(() => h.root.querySelector("fieldset")?.disabled).toBe(true);
    expect(h.root.querySelector('[role="alert"]')?.textContent).toBe("");
    await run(Deferred.succeed(retry, undefined));
    await h.page("Check your email");
    expect(h.failures).toEqual([]);
  });
  it("restores email after reload without sending a code, then resends and verifies", async () => {
    const h = await harness({
      initial: "/verify-code?email=reader%40example.com",
      auth: Option.none(),
    });
    await h.page("Check your email");
    expect(h.commands).toEqual([]);
    expect(h.input("email").readOnly).toBe(true);
    expect(h.input("email").value).toBe("reader@example.com");
    expect(h.input("code").autocomplete).toBe("one-time-code");
    h.button("Resend code").click();
    await expect
      .poll(() => h.root.querySelector('[role="status"]')?.textContent)
      .toContain("A new code has been sent");
    h.input("code").value = "12";
    h.submit();
    await expect.poll(() => h.input("code").getAttribute("aria-invalid")).toBe("true");
    expect(h.commands).toHaveLength(1);
    h.failNext(new AuthError({ kind: "code", message: "This code is invalid or expired." }));
    h.input("code").value = "123456";
    h.submit();
    await expect
      .poll(() => h.root.querySelector('[role="alert"]')?.textContent)
      .toContain("invalid or expired");
    expect(h.history.location()).toBe("/verify-code?email=reader%40example.com");
    h.submit();
    await expect.poll(() => h.commands.length).toBe(3);
    await h.publish({
      _tag: "Ready",
      user: Option.some({ id: "A", email: Option.some("reader@example.com") }),
    });
    await h.page("Create budget");
    expect(h.history.location()).toBe("/new");
    expect(h.commands).toEqual([
      { _tag: "RequestOtp", email: "reader@example.com" },
      { _tag: "VerifyOtp", email: "reader@example.com", code: "123456" },
      { _tag: "VerifyOtp", email: "reader@example.com", code: "123456" },
    ]);
    expect(h.failures).toEqual([]);
  });
  it("allows email entry without a query parameter and navigation back to sign in", async () => {
    const h = await harness({ initial: "/verify-code", auth: Option.none() });
    await h.page("Check your email");
    expect(h.input("email").readOnly).toBe(false);
    h.input("email").value = "reader@example.com";
    h.button("Resend code").click();
    await expect
      .poll(() => h.commands)
      .toEqual([{ _tag: "RequestOtp", email: "reader@example.com" }]);
    await h.follow("Back to sign in");
    await h.page("Sign in");
  });
});
