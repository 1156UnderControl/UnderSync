import { v } from "convex/values";

export const appRoleValidator = v.union(v.literal("ADMIN"), v.literal("MEMBER"));
export const userStatusValidator = v.union(
  v.literal("ACTIVE"),
  v.literal("DISABLED"),
  v.literal("DELETED"),
);
export const providerValidator = v.union(v.literal("ONSHAPE"), v.literal("NOTION"));
export const connectionStatusValidator = v.union(
  v.literal("NOT_CONNECTED"),
  v.literal("CONNECTED"),
  v.literal("ERROR"),
);
export const measurementUnitValidator = v.union(v.literal("MM"), v.literal("IN"));
export const numberFormatValidator = v.union(v.literal("DECIMAL"), v.literal("FRACTION"));

export const userSummaryValidator = v.object({
  id: v.id("users"),
  username: v.string(),
  displayName: v.string(),
  email: v.string(),
  teamRole: v.string(),
  appRole: appRoleValidator,
  status: userStatusValidator,
  measurementUnit: measurementUnitValidator,
  numberFormat: numberFormatValidator,
});

export const integrationSummaryValidator = v.object({
  provider: providerValidator,
  status: connectionStatusValidator,
  externalDisplayName: v.union(v.string(), v.null()),
  externalEmail: v.union(v.string(), v.null()),
});
