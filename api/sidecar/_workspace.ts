export function policyUrlForWorkspace(baseUrl: string, workspaceId: string) {
  const url = new URL(baseUrl);
  url.searchParams.set("workspace", workspaceId);
  return url.toString();
}
