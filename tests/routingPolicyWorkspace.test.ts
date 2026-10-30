import { afterEach, describe, expect, it, vi } from "vitest";
import { routingPolicyWorkspaceId } from "../api/routing-policy/_config";
import { policyUrlForWorkspace } from "../api/sidecar/_workspace";
import { fetchPublishedPolicyHistory } from "../src/core/routingPolicyPersistence";

describe("routing policy workspace isolation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses a valid request workspace and rejects malformed IDs", () => {
    expect(routingPolicyWorkspaceId({ query: { workspace: "personal_abc123" } })).toBe("personal_abc123");
    expect(routingPolicyWorkspaceId({ query: { workspace: "../../demo" } })).toBe("demo");
  });

  it("scopes policy history requests to the selected workspace", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ activeVersion: null, versions: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchPublishedPolicyHistory("personal_abc123");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/routing-policy/versions?workspace=personal_abc123",
      expect.objectContaining({ headers: { Accept: "application/json" } }),
    );
  });

  it("replaces any default workspace on the hosted runtime policy URL", () => {
    expect(policyUrlForWorkspace("https://routelab.example/api/routing-policy/bundle?version=active&workspace=demo", "personal_abc123"))
      .toBe("https://routelab.example/api/routing-policy/bundle?version=active&workspace=personal_abc123");
  });
});
