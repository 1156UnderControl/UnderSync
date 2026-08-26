import { defineApp } from "convex/server";
import { v } from "convex/values";

export default defineApp({
  env: {
    SITE_URL: v.optional(v.string()),
    ONSHAPE_CLIENT_ID: v.optional(v.string()),
    ONSHAPE_CLIENT_SECRET: v.optional(v.string()),
    ONSHAPE_REDIRECT_URI: v.optional(v.string()),
    ONSHAPE_AUTHORIZATION_URL: v.optional(v.string()),
    ONSHAPE_TOKEN_URL: v.optional(v.string()),
    ONSHAPE_API_BASE_URL: v.optional(v.string()),
    INTEGRATION_ENCRYPTION_KEY: v.optional(v.string()),
  },
});
