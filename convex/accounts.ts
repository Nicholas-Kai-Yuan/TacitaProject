import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const role = v.union(v.literal("it_admin"), v.literal("admin"), v.literal("interviewer"));
const managedRole = v.union(v.literal("admin"), v.literal("interviewer"));

const accountFields = {
  username: v.string(),
  displayName: v.string(),
  passwordHash: v.string(),
  passwordSalt: v.string(),
};

export const listManaged = query({
  args: {},
  handler: async (ctx) => {
    const accounts = await ctx.db.query("accounts").collect();
    return accounts
      .filter((account) => account.role === "admin" || account.role === "interviewer")
      .sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const listInterviewers = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("accounts")
      .withIndex("by_role", (q) => q.eq("role", "interviewer"))
      .order("desc")
      .collect();
  },
});

export const getByUsername = query({
  args: {
    username: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("accounts")
      .withIndex("by_username", (q) => q.eq("username", args.username))
      .unique();
  },
});

export const get = query({
  args: {
    id: v.id("accounts"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const create = mutation({
  args: {
    ...accountFields,
    role: managedRole,
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("accounts")
      .withIndex("by_username", (q) => q.eq("username", args.username))
      .unique();

    if (existing) {
      throw new Error("Username already exists");
    }

    const now = Date.now();
    return await ctx.db.insert("accounts", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("accounts"),
    username: v.string(),
    displayName: v.string(),
    role: managedRole,
    passwordHash: v.optional(v.string()),
    passwordSalt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.id);
    if (!account || account.role === "it_admin") {
      throw new Error("Managed account not found");
    }

    const usernameOwner = await ctx.db
      .query("accounts")
      .withIndex("by_username", (q) => q.eq("username", args.username))
      .unique();

    if (usernameOwner && usernameOwner._id !== args.id) {
      throw new Error("Username already exists");
    }

    await ctx.db.patch(args.id, {
      username: args.username,
      displayName: args.displayName,
      role: args.role,
      passwordHash: args.passwordHash ?? account.passwordHash,
      passwordSalt: args.passwordSalt ?? account.passwordSalt,
      updatedAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: {
    id: v.id("accounts"),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.id);
    if (!account || account.role === "it_admin") {
      throw new Error("Managed account not found");
    }

    await ctx.db.delete(args.id);
  },
});

export const bootstrap = mutation({
  args: {
    username: v.string(),
    displayName: v.string(),
    role,
    passwordHash: v.string(),
    passwordSalt: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("accounts")
      .withIndex("by_username", (q) => q.eq("username", args.username))
      .unique();

    if (existing) {
      return existing._id;
    }

    const now = Date.now();
    return await ctx.db.insert("accounts", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});
