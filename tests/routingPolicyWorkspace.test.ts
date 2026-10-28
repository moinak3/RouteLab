import { afterEach, describe, expect, it, vi } from "vitest";
import { routingPolicyWorkspaceId } from "../api/routing-policy/_config";
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
});
