const validWorkspaceId = /^[a-z0-9][a-z0-9_-]{0,127}$/i;

export const routingPolicyWorkspaceId = (req?: any) => {
  const requested = String(req?.query?.workspace ?? "").trim();
  if (requested && validWorkspaceId.test(requested)) return requested;
  return String(process.env.ROUTELAB_POLICY_WORKSPACE_ID ?? "demo").trim() || "demo";
};
export const routingPolicyDatabaseUrl = () => String(process.env.DATABASE_URL ?? "").trim();
export const routingPolicySigningConfig = () => ({
  privateKey: String(process.env.ROUTELAB_POLICY_SIGNING_PRIVATE_KEY ?? "").trim(),
  publicKey: String(process.env.ROUTELAB_POLICY_SIGNING_PUBLIC_KEY ?? "").trim(),
  keyId: String(process.env.ROUTELAB_POLICY_SIGNING_KEY_ID ?? "routelab-policy-signing-key").trim(),
});
