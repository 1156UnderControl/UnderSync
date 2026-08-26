import { env } from "../_generated/server";

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is not configured in this Convex deployment.`);
  return value;
}

export function onshapeConfig() {
  return {
    clientId: required("ONSHAPE_CLIENT_ID", env.ONSHAPE_CLIENT_ID),
    clientSecret: required("ONSHAPE_CLIENT_SECRET", env.ONSHAPE_CLIENT_SECRET),
    redirectUri: required("ONSHAPE_REDIRECT_URI", env.ONSHAPE_REDIRECT_URI),
    authorizationUrl: env.ONSHAPE_AUTHORIZATION_URL ?? "https://oauth.onshape.com/oauth/authorize",
    tokenUrl: env.ONSHAPE_TOKEN_URL ?? "https://oauth.onshape.com/oauth/token",
    apiBaseUrl: env.ONSHAPE_API_BASE_URL ?? "https://cad.onshape.com",
    encryptionKey: required("INTEGRATION_ENCRYPTION_KEY", env.INTEGRATION_ENCRYPTION_KEY),
    siteUrl: required("SITE_URL", env.SITE_URL),
  };
}
