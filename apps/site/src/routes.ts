import { route, router } from "@charismaticalli/frappe/router";
import { examplesRoute } from "./examples-routes";

export const urls = router([
  route({ tag: "Home", path: [] }),
  examplesRoute,
  route({ tag: "Routing", path: ["routing"] }),
  route({ tag: "Queries", path: ["queries"] }),
]);
