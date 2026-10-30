import { describe, expect, it } from "vitest";
import { appPageRoutes, pageForPath, pathForPage } from "../src/appRoutes";

describe("app routes", () => {
  it("gives every logged-in page a unique URL", () => {
    const paths = Object.values(appPageRoutes);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths.every((path) => path.startsWith("/") && path !== "/")).toBe(true);
  });

  it("round-trips every logged-in page through its path", () => {
    for (const page of Object.keys(appPageRoutes) as Array<keyof typeof appPageRoutes>) {
      expect(pageForPath(pathForPage(page))).toBe(page);
    }
  });

  it("maps the marketing home and accepts trailing slashes", () => {
    expect(pathForPage("Home")).toBe("/");
    expect(pageForPath("/")).toBe("Home");
    expect(pageForPath("/quality/review-queue/")).toBe("Review Queue");
    expect(pathForPage("Classifier Validation")).toBe("/routing/classifier-validation");
    expect(pageForPath("/quality/classifier-validation")).toBe("Classifier Validation");
  });

  it("does not silently map unknown paths", () => {
    expect(pageForPath("/not-a-route")).toBeUndefined();
  });
});
