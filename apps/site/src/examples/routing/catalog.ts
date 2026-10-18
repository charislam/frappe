import { ProjectId } from "./routes";

export const projectCatalog = [
  {
    id: ProjectId.make(123),
    name: "Website launch",
    description: "Bring the new company website from first draft to launch day.",
    status: "In progress",
    owner: "Design team",
    due: "This week",
  },
  {
    id: ProjectId.make(456),
    name: "Mobile onboarding",
    description: "Help new customers find their first success in the mobile app.",
    status: "Planning",
    owner: "Product team",
    due: "Next week",
  },
] as const;
