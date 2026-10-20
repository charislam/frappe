import { Option } from "effect";
import { expect } from "vitest";

export const pageControls = (options: { root: HTMLElement; failures: ReadonlyArray<string> }) => {
  const { root, failures } = options;
  const page = async (heading: string) => {
    await expect.poll(() => root.querySelector("h1")?.textContent).toBe(heading);
    expect(failures).toEqual([]);
  };
  const input = (name: string) =>
    Option.getOrThrow(
      Option.fromNullishOr(root.querySelector<HTMLInputElement>(`input[name="${name}"]`)),
    );
  const button = (label: string) =>
    Option.getOrThrow(
      Option.fromNullishOr(
        Array.from(root.querySelectorAll("button")).find((button) => button.textContent === label),
      ),
    );
  const follow = async (label: string) => {
    await expect
      .poll(() =>
        Array.from(root.querySelectorAll("a")).some((anchor) => anchor.textContent === label),
      )
      .toBe(true);
    const anchor = Option.getOrThrow(
      Option.fromNullishOr(
        Array.from(root.querySelectorAll("a")).find((anchor) => anchor.textContent === label),
      ),
    );
    anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  };
  const submit = () => {
    const form = Option.getOrThrow(Option.fromNullishOr(root.querySelector("form")));
    const event = new Event("submit", { bubbles: true, cancelable: true });
    form.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  };
  return { page, input, button, follow, submit };
};
