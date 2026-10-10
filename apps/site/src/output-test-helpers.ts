import { component, type ElementOutput } from "@charismaticalli/frappe";
import * as Sync from "@charismaticalli/frappe";

export const testText = (value: string) =>
  component((context) =>
    Sync.succeed({
      setup: () => context.importNative(document.createTextNode(value)),
    }),
  );

export const untypedOutput = (value: unknown): ElementOutput<Node> => value as ElementOutput<Node>;
