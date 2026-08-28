import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireAdmin } from "./lib/auth";

const settingsValidator = v.object({
  appName: v.string(), organizationName: v.string(), teamNumber: v.string(), seasonCode: v.string(),
  partCodeSeparator: v.string(), partSequenceDigits: v.number(),
});
const requestValidator = v.object({
  id: v.id("archiveRequests"), status: v.union(v.literal("PENDING"), v.literal("APPROVED"), v.literal("REJECTED")),
  requestedBy: v.id("users"), requesterName: v.string(), requestedAt: v.number(),
  decidedBy: v.union(v.id("users"), v.null()), deciderName: v.union(v.string(), v.null()),
  decidedAt: v.union(v.number(), v.null()),
});

const defaults = {
  appName: "UnderSync", organizationName: "FRC 1156 · Under Control", teamNumber: "1156",
  seasonCode: "26", partCodeSeparator: "-", partSequenceDigits: "2",
} as const;

async function readSetting(ctx: Parameters<typeof requireAdmin>[0], key: string, fallback: string) {
  const row = await ctx.db.query("appSettings").withIndex("by_key", (q) => q.eq("key", key)).unique();
  return row?.value ?? fallback;
}

export const get = query({
  args: {},
  returns: v.object({
    settings: settingsValidator,
    subsystems: v.array(v.object({ id: v.id("subsystems"), code: v.string(), name: v.string(), active: v.boolean() })),
    archiveRequests: v.array(requestValidator),
  }),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const [appName, organizationName, teamNumber, seasonCode, partCodeSeparator, digits, subsystems, requests] = await Promise.all([
      readSetting(ctx, "appName", defaults.appName), readSetting(ctx, "organizationName", defaults.organizationName),
      readSetting(ctx, "teamNumber", defaults.teamNumber), readSetting(ctx, "seasonCode", defaults.seasonCode),
      readSetting(ctx, "partCodeSeparator", defaults.partCodeSeparator), readSetting(ctx, "partSequenceDigits", defaults.partSequenceDigits),
      ctx.db.query("subsystems").order("asc").take(100), ctx.db.query("archiveRequests").order("desc").take(50),
    ]);
    const archiveRequests = [];
    for (const request of requests) {
      const [requester, decider] = await Promise.all([
        ctx.db.get("users", request.requestedBy),
        request.decidedBy ? ctx.db.get("users", request.decidedBy) : Promise.resolve(null),
      ]);
      archiveRequests.push({
        id: request._id, status: request.status, requestedBy: request.requestedBy,
        requesterName: requester?.displayName ?? requester?.name ?? "Unknown administrator",
        requestedAt: request.requestedAt, decidedBy: request.decidedBy ?? null,
        deciderName: decider?.displayName ?? decider?.name ?? null, decidedAt: request.decidedAt ?? null,
      });
    }
    return {
      settings: {
        appName, organizationName, teamNumber, seasonCode, partCodeSeparator,
        partSequenceDigits: Number.parseInt(digits, 10) || 2,
      },
      subsystems: subsystems.map((row) => ({ id: row._id, code: row.code, name: row.name, active: row.active })),
      archiveRequests,
    };
  },
});

export const saveSettings = mutation({
  args: settingsValidator.fields,
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const appName = args.appName.trim(); const organizationName = args.organizationName.trim();
    const teamNumber = args.teamNumber.trim().toUpperCase(); const seasonCode = args.seasonCode.trim().toUpperCase();
    const separator = args.partCodeSeparator.trim();
    if (appName.length < 2 || appName.length > 80 || organizationName.length < 2 || organizationName.length > 120) throw new Error("Check the application and organization names.");
    if (!/^[A-Z0-9]{1,12}$/.test(teamNumber) || !/^[A-Z0-9]{1,12}$/.test(seasonCode)) throw new Error("Team and season codes may contain only letters and numbers.");
    if (!/^[-_.]{1,3}$/.test(separator)) throw new Error("The separator must be 1 to 3 dashes, underscores, or dots.");
    if (!Number.isInteger(args.partSequenceDigits) || args.partSequenceDigits < 2 || args.partSequenceDigits > 8) throw new Error("Sequence digits must be from 2 to 8.");
    const values = { appName, organizationName, teamNumber, seasonCode, partCodeSeparator: separator, partSequenceDigits: String(args.partSequenceDigits) };
    for (const [key, value] of Object.entries(values)) {
      const row = await ctx.db.query("appSettings").withIndex("by_key", (q) => q.eq("key", key)).unique();
      if (row) await ctx.db.patch("appSettings", row._id, { value }); else await ctx.db.insert("appSettings", { key, value });
    }
    await ctx.db.insert("auditEvents", { actorUserId: admin._id, action: "UNDERSYNC_SETTINGS_UPDATED", targetType: "settings", targetId: "undersync", summary: "Updated global UnderSync settings.", createdAt: Date.now() });
    return null;
  },
});

function normalizedCode(value: string) {
  const code = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  if (code.length < 2) throw new Error("Subsystem code must contain at least two letters or numbers.");
  return code;
}

export const addSubsystem = mutation({
  args: { name: v.string(), code: v.string() }, returns: v.id("subsystems"),
  handler: async (ctx, args) => {
    await requireAdmin(ctx); const name = args.name.trim(); const code = normalizedCode(args.code || name);
    if (name.length < 2 || name.length > 100) throw new Error("Enter a valid subsystem name.");
    if (await ctx.db.query("subsystems").withIndex("by_code", (q) => q.eq("code", code)).unique()) throw new Error("That subsystem code already exists.");
    return await ctx.db.insert("subsystems", { name, code, active: true });
  },
});

export const updateSubsystem = mutation({
  args: { id: v.id("subsystems"), name: v.string(), active: v.boolean() }, returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx); const name = args.name.trim();
    if (name.length < 2 || name.length > 100) throw new Error("Enter a valid subsystem name.");
    await ctx.db.patch("subsystems", args.id, { name, active: args.active }); return null;
  },
});

export const deleteSubsystem = mutation({
  args: { id: v.id("subsystems") }, returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    if (await ctx.db.query("parts").withIndex("by_subsystemId", (q) => q.eq("subsystemId", args.id)).first()) throw new Error("This subsystem has registered parts. Disable it instead.");
    await ctx.db.delete("subsystems", args.id); return null;
  },
});

export const requestArchive = mutation({
  args: {}, returns: v.id("archiveRequests"),
  handler: async (ctx) => {
    const admin = await requireAdmin(ctx);
    const activeAdmins = await ctx.db.query("users").withIndex("by_appRole_and_status", (q) => q.eq("appRole", "ADMIN").eq("status", "ACTIVE")).take(3);
    if (activeAdmins.length < 2) throw new Error("A second active administrator is required before archive requests can be created.");
    const pending = await ctx.db.query("archiveRequests").withIndex("by_status", (q) => q.eq("status", "PENDING")).first();
    if (pending) throw new Error("An archive request is already waiting for approval.");
    const id = await ctx.db.insert("archiveRequests", { scope: "PARTS_AND_BUY_LIST", status: "PENDING", requestedBy: admin._id, requestedAt: Date.now() });
    await ctx.db.insert("auditEvents", { actorUserId: admin._id, action: "ARCHIVE_REQUESTED", targetType: "archiveRequest", targetId: id, summary: "Requested archival of all active parts and buy-list items.", createdAt: Date.now() });
    return id;
  },
});

export const decideArchive = mutation({
  args: { requestId: v.id("archiveRequests"), approve: v.boolean() }, returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx); const request = await ctx.db.get("archiveRequests", args.requestId);
    if (!request || request.status !== "PENDING") throw new Error("This archive request is no longer pending.");
    if (request.requestedBy === admin._id) throw new Error("A different administrator must decide this request.");
    const now = Date.now(); const status = args.approve ? "APPROVED" as const : "REJECTED" as const;
    await ctx.db.patch("archiveRequests", request._id, { status, decidedBy: admin._id, decidedAt: now });
    if (args.approve) await ctx.scheduler.runAfter(0, internal.undersyncAdmin.archiveBatch, {});
    await ctx.db.insert("auditEvents", { actorUserId: admin._id, action: args.approve ? "ARCHIVE_APPROVED" : "ARCHIVE_REJECTED", targetType: "archiveRequest", targetId: request._id, summary: `${status.toLowerCase()} the archive request.`, createdAt: now });
    return null;
  },
});

export const archiveBatch = internalMutation({
  args: {}, returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const [parts, buyItems] = await Promise.all([
      ctx.db.query("parts").withIndex("by_status", (q) => q.eq("status", "IN_DEVELOPMENT")).take(100),
      ctx.db.query("buyListItems").withIndex("by_archivedAt", (q) => q.eq("archivedAt", undefined)).take(100),
    ]);
    for (const part of parts) await ctx.db.patch("parts", part._id, { status: "ARCHIVED" });
    for (const item of buyItems) await ctx.db.patch("buyListItems", item._id, { archivedAt: now, updatedAt: now });
    if (parts.length === 100 || buyItems.length === 100) await ctx.scheduler.runAfter(0, internal.undersyncAdmin.archiveBatch, {});
    return null;
  },
});
