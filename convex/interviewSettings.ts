import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const settingArgs = {
  interviewerName: v.string(),
  smeName: v.string(),
  jobRoleTitle: v.string(),
  domainIndustry: v.string(),
  jobDescription: v.string(),
  interviewObjective: v.string(),
  keyFocusAreas: v.string(),
  actaRatio: v.string(),
  assignedInterviewerAccountId: v.optional(v.union(v.id("accounts"), v.null())),
};

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("interviewSettings").order("desc").collect();
  },
});

export const create = mutation({
  args: settingArgs,
  handler: async (ctx, args) => {
    const now = Date.now();
    const { assignedInterviewerAccountId, ...setting } = args;
    return await ctx.db.insert("interviewSettings", {
      ...setting,
      ...(assignedInterviewerAccountId ? { assignedInterviewerAccountId } : {}),
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("interviewSettings"),
    ...settingArgs,
  },
  handler: async (ctx, args) => {
    const { id, assignedInterviewerAccountId, ...patch } = args;
    await ctx.db.patch(id, {
      ...patch,
      assignedInterviewerAccountId: assignedInterviewerAccountId ?? undefined,
      updatedAt: Date.now(),
    });
  },
});

export const updateAccess = mutation({
  args: {
    id: v.id("interviewSettings"),
    interviewerAccountId: v.union(v.id("accounts"), v.null()),
  },
  handler: async (ctx, args) => {
    if (args.interviewerAccountId) {
      const account = await ctx.db.get(args.interviewerAccountId);
      if (!account || account.role !== "interviewer") {
        throw new Error("Interviewer account not found");
      }
    }

    await ctx.db.patch(args.id, {
      assignedInterviewerAccountId: args.interviewerAccountId ?? undefined,
      updatedAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: {
    id: v.id("interviewSettings"),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});
