import { email, natural, password, text } from "./schemas";

export const fields = [
  {
    name: "name",
    schema: text,
    type: "text",
    inputmode: "text",
    label: "Full name",
    help: "The name your teammates will see.",
    error: "Enter your name to continue.",
    placeholder: "Alex Morgan",
    autocomplete: "name",
  },
  {
    name: "email",
    schema: email,
    type: "email",
    inputmode: "email",
    label: "Work email",
    help: "Use the address you share with your team.",
    error: "Enter an email address like alex@company.com.",
    placeholder: "alex@company.com",
    autocomplete: "email",
  },
  {
    name: "password",
    schema: password,
    type: "password",
    inputmode: "text",
    label: "Password",
    help: "Use at least 8 characters. Spaces are welcome.",
    error: "Your password needs at least 8 characters.",
    placeholder: "Choose a password",
    autocomplete: "new-password",
  },
  {
    name: "team-size",
    schema: natural,
    type: "text",
    inputmode: "numeric",
    label: "Team size",
    help: "How many teammates will you invite? You can start with 0.",
    error: "Enter a whole number of teammates, such as 0, 5, or 12.",
    placeholder: "e.g. 12",
    autocomplete: "off",
  },
] as const;

export type FieldDefinition = (typeof fields)[number];
