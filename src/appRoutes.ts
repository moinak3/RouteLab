import type { Page } from "./types/ui";

type AppPage = Exclude<Page, "Home">;

export const appPageRoutes: Record<AppPage, string> = {
  Overview: "/overview",
  Traces: "/workloads/traces",
  "Distinct Tasks": "/workloads/task-groups",
  Evals: "/quality/eval-library",
  "Golden Dataset": "/quality/human-calibration",
  "Classifier Validation": "/routing/classifier-validation",
  "Review Queue": "/quality/review-queue",
  Simulations: "/routing-simulations",
  Benchmarking: "/benchmarking",
  Recommendations: "/routes/recommendations",
  "Fine-Tuning": "/routes/fine-tuning",
  "Model Catalog": "/settings/model-catalog",
};

const pagesByPath = new Map<string, AppPage>(
  Object.entries(appPageRoutes).map(([page, path]) => [path, page as AppPage]),
);
pagesByPath.set("/quality/classifier-validation", "Classifier Validation");

function normalizePath(pathname: string) {
  if (!pathname || pathname === "/") return "/";
  return pathname.replace(/\/+$/, "") || "/";
}

export function pathForPage(page: Page) {
  return page === "Home" ? "/" : appPageRoutes[page];
}

export function pageForPath(pathname: string): Page | undefined {
  const normalized = normalizePath(pathname);
  if (normalized === "/") return "Home";
  return pagesByPath.get(normalized);
}
