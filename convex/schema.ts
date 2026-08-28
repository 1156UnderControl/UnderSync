import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  appRoleValidator,
  connectionStatusValidator,
  providerValidator,
  userStatusValidator,
} from "./validators";

export default defineSchema({
  ...authTables,
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    appUsername: v.optional(v.string()),
    displayName: v.optional(v.string()),
    teamRole: v.optional(v.string()),
    appRole: v.optional(appRoleValidator),
    status: v.optional(userStatusValidator),
  })
    .index("email", ["email"])
    .index("phone", ["phone"])
    .index("by_appUsername", ["appUsername"])
    .index("by_appRole", ["appRole"])
    .index("by_appRole_and_status", ["appRole", "status"])
    .index("by_status", ["status"]),

  integrationAccounts: defineTable({
    userId: v.id("users"),
    provider: providerValidator,
    status: connectionStatusValidator,
    externalUserId: v.optional(v.string()),
    externalDisplayName: v.optional(v.string()),
    externalEmail: v.optional(v.string()),
    lastError: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_userId_and_provider", ["userId", "provider"])
    .index("by_provider", ["provider"])
    .index("by_provider_and_externalUserId", ["provider", "externalUserId"]),

  onshapeOAuthStates: defineTable({
    userId: v.id("users"),
    stateHash: v.string(),
    redirectUri: v.string(),
    expiresAt: v.number(),
    consumedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_stateHash", ["stateHash"])
    .index("by_userId", ["userId"]),

  onshapeOAuthGrants: defineTable({
    integrationAccountId: v.id("integrationAccounts"),
    accessTokenEncrypted: v.string(),
    refreshTokenEncrypted: v.optional(v.string()),
    tokenType: v.string(),
    scope: v.optional(v.string()),
    expiresAt: v.number(),
    updatedAt: v.number(),
  }).index("by_integrationAccountId", ["integrationAccountId"]),

  appSettings: defineTable({
    key: v.string(),
    value: v.string(),
  }).index("by_key", ["key"]),

  counters: defineTable({
    key: v.string(),
    value: v.number(),
  }).index("by_key", ["key"]),

  subsystems: defineTable({
    code: v.string(),
    name: v.string(),
    active: v.boolean(),
  }).index("by_code", ["code"]),

  manufacturingMethods: defineTable({
    code: v.string(),
    name: v.string(),
    active: v.boolean(),
  }).index("by_code", ["code"]),

  materials: defineTable({
    code: v.string(),
    name: v.string(),
    active: v.boolean(),
  }).index("by_code", ["code"]),

  manufacturingMethodMaterials: defineTable({
    manufacturingMethodId: v.id("manufacturingMethods"),
    materialId: v.id("materials"),
  })
    .index("by_manufacturingMethodId_and_materialId", ["manufacturingMethodId", "materialId"])
    .index("by_materialId_and_manufacturingMethodId", ["materialId", "manufacturingMethodId"]),

  parts: defineTable({
    trackingCode: v.string(),
    sequenceValue: v.number(),
    name: v.string(),
    quantity: v.number(),
    subsystemId: v.id("subsystems"),
    designerId: v.id("users"),
    manufacturingMethodId: v.id("manufacturingMethods"),
    materialId: v.id("materials"),
    status: v.union(v.literal("IN_DEVELOPMENT"), v.literal("ARCHIVED")),
    createdBy: v.id("users"),
    createdAt: v.number(),
    onshapeDocumentId: v.optional(v.string()),
    onshapeWorkspaceId: v.optional(v.string()),
    onshapeElementId: v.optional(v.string()),
    onshapePartId: v.optional(v.string()),
    onshapeConfiguration: v.optional(v.string()),
    onshapeMicroversionId: v.optional(v.string()),
  })
    .index("by_trackingCode", ["trackingCode"])
    .index("by_createdBy", ["createdBy"])
    .index("by_status", ["status"])
    .index("by_manufacturingMethodId", ["manufacturingMethodId"])
    .index("by_materialId", ["materialId"])
    .index("by_subsystemId", ["subsystemId"])
    .index("by_onshapeDocumentId_and_onshapeElementId_and_onshapePartId", ["onshapeDocumentId", "onshapeElementId", "onshapePartId"]),

  cotsTypes: defineTable({
    name: v.string(),
    slug: v.string(),
    icon: v.string(),
    sortOrder: v.number(),
    active: v.boolean(),
  })
    .index("by_slug", ["slug"])
    .index("by_active_and_sortOrder", ["active", "sortOrder"]),

  cotsStatuses: defineTable({
    name: v.string(),
    code: v.string(),
    sortOrder: v.number(),
    active: v.boolean(),
  })
    .index("by_code", ["code"])
    .index("by_active_and_sortOrder", ["active", "sortOrder"]),

  cotsFieldDefinitions: defineTable({
    cotsTypeId: v.id("cotsTypes"),
    key: v.string(),
    label: v.string(),
    fieldType: v.optional(v.union(v.literal("STRING"), v.literal("BOOLEAN"))),
    sortOrder: v.number(),
    active: v.boolean(),
  })
    .index("by_cotsTypeId_and_sortOrder", ["cotsTypeId", "sortOrder"])
    .index("by_cotsTypeId_and_key", ["cotsTypeId", "key"]),

  cotsItems: defineTable({
    cotsTypeId: v.id("cotsTypes"),
    name: v.string(),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_cotsTypeId", ["cotsTypeId"]),

  cotsItemFieldValues: defineTable({
    cotsItemId: v.id("cotsItems"),
    fieldDefinitionId: v.id("cotsFieldDefinitions"),
    value: v.string(),
  })
    .index("by_cotsItemId_and_fieldDefinitionId", ["cotsItemId", "fieldDefinitionId"])
    .index("by_fieldDefinitionId", ["fieldDefinitionId"]),

  cotsItemQuantities: defineTable({
    cotsItemId: v.id("cotsItems"),
    statusId: v.id("cotsStatuses"),
    quantity: v.number(),
  })
    .index("by_cotsItemId_and_statusId", ["cotsItemId", "statusId"])
    .index("by_statusId", ["statusId"]),

  buyListTypes: defineTable({
    name: v.string(),
    slug: v.string(),
    icon: v.string(),
    sortOrder: v.number(),
    active: v.boolean(),
  })
    .index("by_slug", ["slug"])
    .index("by_active_and_sortOrder", ["active", "sortOrder"]),

  buyListFieldDefinitions: defineTable({
    buyListTypeId: v.id("buyListTypes"),
    key: v.string(),
    label: v.string(),
    fieldType: v.union(v.literal("STRING"), v.literal("BOOLEAN")),
    sortOrder: v.number(),
    active: v.boolean(),
  })
    .index("by_buyListTypeId_and_sortOrder", ["buyListTypeId", "sortOrder"])
    .index("by_buyListTypeId_and_key", ["buyListTypeId", "key"]),

  buyListItems: defineTable({
    buyListTypeId: v.id("buyListTypes"),
    name: v.string(),
    quantity: v.number(),
    purchased: v.boolean(),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
    archivedAt: v.optional(v.number()),
  })
    .index("by_buyListTypeId", ["buyListTypeId"])
    .index("by_buyListTypeId_and_archivedAt", ["buyListTypeId", "archivedAt"])
    .index("by_archivedAt", ["archivedAt"]),

  buyListItemFieldValues: defineTable({
    buyListItemId: v.id("buyListItems"),
    fieldDefinitionId: v.id("buyListFieldDefinitions"),
    value: v.string(),
  })
    .index("by_buyListItemId_and_fieldDefinitionId", ["buyListItemId", "fieldDefinitionId"])
    .index("by_fieldDefinitionId", ["fieldDefinitionId"]),

  partExports: defineTable({
    partId: v.id("parts"),
    storageId: v.id("_storage"),
    format: v.union(v.literal("STL"), v.literal("PARASOLID")),
    createdBy: v.id("users"),
    createdAt: v.number(),
  }).index("by_partId", ["partId"]),

  archiveRequests: defineTable({
    scope: v.literal("PARTS_AND_BUY_LIST"),
    status: v.union(v.literal("PENDING"), v.literal("APPROVED"), v.literal("REJECTED")),
    requestedBy: v.id("users"),
    requestedAt: v.number(),
    decidedBy: v.optional(v.id("users")),
    decidedAt: v.optional(v.number()),
  })
    .index("by_status", ["status"])
    .index("by_requestedBy_and_status", ["requestedBy", "status"]),

  auditEvents: defineTable({
    actorUserId: v.id("users"),
    action: v.string(),
    targetType: v.string(),
    targetId: v.string(),
    summary: v.string(),
    createdAt: v.number(),
  })
    .index("by_actorUserId", ["actorUserId"])
    .index("by_targetType_and_targetId", ["targetType", "targetId"]),
});
