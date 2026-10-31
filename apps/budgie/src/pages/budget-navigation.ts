import type { BudgetId } from "~/budget/model";
import { budgetDestination } from "~/routes";
import { navigateAuth } from "./auth-navigation";

export const navigateBudget = (id: BudgetId) =>
  navigateAuth({
    destination: budgetDestination(id),
    mode: "replace",
  });
