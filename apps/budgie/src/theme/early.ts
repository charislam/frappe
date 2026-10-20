import { readPreference, resolveTheme } from "./model";
// Bundled into the document head by Vite, before styles or application mounting.
document.documentElement.dataset["theme"] = resolveTheme({
  preference: readPreference(() => localStorage),
  systemDark: matchMedia("(prefers-color-scheme: dark)").matches,
});
