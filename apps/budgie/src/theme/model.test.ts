import { describe, expect, it } from "vitest";
import {
  decodePreference,
  readPreference,
  resolveTheme,
  savePreference,
  storageKey,
} from "./model";

describe("theme preferences", () => {
  it("resolves system and explicit preferences", () => {
    expect(resolveTheme({ preference: "system", systemDark: true })).toBe("dark");
    expect(resolveTheme({ preference: "system", systemDark: false })).toBe("light");
    expect(resolveTheme({ preference: "light", systemDark: true })).toBe("light");
    expect(resolveTheme({ preference: "dark", systemDark: false })).toBe("dark");
    expect(decodePreference("corrupt")).toBe("system");
  });
  it("persists to a Budgie-specific key and tolerates unavailable storage", () => {
    const saved = new Map<string, string>();
    const storage = () => ({
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => {
        saved.set(key, value);
      },
    });
    savePreference({ storage, preference: "dark" });
    expect(saved.get(storageKey)).toBe("dark");
    expect(readPreference(storage)).toBe("dark");
    const unavailable = () => {
      throw new Error("Blocked");
    };
    expect(readPreference(unavailable)).toBe("system");
    expect(() => savePreference({ storage: unavailable, preference: "light" })).not.toThrow();
  });
});
