import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const actaLevel = v.union(v.literal("L1"), v.literal("L2"), v.literal("L3"));
const questionStatus = v.union(v.literal("planned"), v.literal("asked"), v.literal("skipped"));
const speaker = v.union(v.literal("interviewer"), v.literal("sme"), v.literal("unknown"));

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("interviewSessions").order("desc").collect();
  },
});

export const get = query({
  args: {
    id: v.id("interviewSessions"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const create = mutation({
  args: {
    settingId: v.id("interviewSettings"),
    interviewerAccountId: v.id("accounts"),
  },
  handler: async (ctx, args) => {
    const setting = await ctx.db.get(args.settingId);
    if (!setting) {
      throw new Error("Interview setting not found");
    }

    if (setting.assignedInterviewerAccountId !== args.interviewerAccountId) {
      throw new Error("This interviewer does not have access to the interview setting");
    }

    const now = Date.now();
    const { _id, _creationTime, ...settingSnapshot } = setting;

    return await ctx.db.insert("interviewSessions", {
      settingId: args.settingId,
      interviewerAccountId: args.interviewerAccountId,
      settingSnapshot,
      status: "draft",
      createdAt: now,
      updatedAt: now,
      starterQuestions: [],
      transcriptSegments: [],
      followUpSuggestions: [],
      chatMessages: [
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: createInitialWelcome(settingSnapshot),
          createdAt: now,
        },
      ],
    });
  },
});

export const replaceStarterQuestions = mutation({
  args: {
    id: v.id("interviewSessions"),
    questions: v.array(
      v.object({
        id: v.string(),
        text: v.string(),
        actaLevel,
        focus: v.string(),
        status: questionStatus,
        source: v.union(v.literal("starter"), v.literal("follow_up")),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      starterQuestions: args.questions,
      status: "questions_generated",
      updatedAt: Date.now(),
    });
  },
});

export const updateQuestion = mutation({
  args: {
    id: v.id("interviewSessions"),
    questionId: v.string(),
    text: v.optional(v.string()),
    status: v.optional(questionStatus),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.id);
    if (!session) {
      throw new Error("Interview session not found");
    }

    await ctx.db.patch(args.id, {
      starterQuestions: session.starterQuestions.map((question) =>
        question.id === args.questionId
          ? {
              ...question,
              text: args.text ?? question.text,
              status: args.status ?? question.status,
            }
          : question,
      ),
      updatedAt: Date.now(),
    });
  },
});

export const approveQuestions = mutation({
  args: {
    id: v.id("interviewSessions"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "ready",
      questionsApprovedAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const start = mutation({
  args: {
    id: v.id("interviewSessions"),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.id);
    await ctx.db.patch(args.id, {
      status: "in_progress",
      startedAt: session?.startedAt ?? Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const addTranscriptSegment = mutation({
  args: {
    id: v.id("interviewSessions"),
    speaker,
    text: v.string(),
    submittedForAi: v.boolean(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.id);
    if (!session) {
      throw new Error("Interview session not found");
    }

    await ctx.db.patch(args.id, {
      transcriptSegments: [
        ...session.transcriptSegments,
        {
          id: crypto.randomUUID(),
          speaker: args.speaker,
          text: args.text,
          createdAt: Date.now(),
          submittedForAi: args.submittedForAi,
        },
      ],
      updatedAt: Date.now(),
    });
  },
});

export const addFollowUps = mutation({
  args: {
    id: v.id("interviewSessions"),
    suggestions: v.array(
      v.object({
        id: v.string(),
        text: v.string(),
        actaLevel,
        focus: v.string(),
        rationale: v.string(),
        createdAt: v.number(),
        used: v.boolean(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.id);
    if (!session) {
      throw new Error("Interview session not found");
    }

    await ctx.db.patch(args.id, {
      followUpSuggestions: [...args.suggestions, ...session.followUpSuggestions],
      updatedAt: Date.now(),
    });
  },
});

export const markSuggestionUsed = mutation({
  args: {
    id: v.id("interviewSessions"),
    suggestionId: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.id);
    if (!session) {
      throw new Error("Interview session not found");
    }

    const suggestion = session.followUpSuggestions.find((item) => item.id === args.suggestionId);
    if (!suggestion) {
      throw new Error("Suggestion not found");
    }

    await ctx.db.patch(args.id, {
      followUpSuggestions: session.followUpSuggestions.map((item) =>
        item.id === args.suggestionId ? { ...item, used: true } : item,
      ),
      starterQuestions: [
        ...session.starterQuestions,
        {
          id: crypto.randomUUID(),
          text: suggestion.text,
          actaLevel: suggestion.actaLevel,
          focus: suggestion.focus,
          status: "asked",
          source: "follow_up",
        },
      ],
      updatedAt: Date.now(),
    });
  },
});

export const addChatExchange = mutation({
  args: {
    id: v.id("interviewSessions"),
    userMessage: v.string(),
    assistantMessage: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.id);
    if (!session) {
      throw new Error("Interview session not found");
    }

    const now = Date.now();
    await ctx.db.patch(args.id, {
      chatMessages: [
        ...session.chatMessages,
        {
          id: crypto.randomUUID(),
          role: "user",
          content: args.userMessage,
          createdAt: now,
        },
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: args.assistantMessage,
          createdAt: now + 1,
        },
      ],
      updatedAt: now,
    });
  },
});

export const end = mutation({
  args: {
    id: v.id("interviewSessions"),
    summary: v.object({
      generatedAt: v.number(),
      taskMap: v.array(v.string()),
      tacitKnowledge: v.array(v.string()),
      scenarioFindings: v.array(v.string()),
      futureExploration: v.array(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "ended",
      endedAt: Date.now(),
      summary: args.summary,
      updatedAt: Date.now(),
    });
  },
});

export const setRefinedTranscript = mutation({
  args: {
    id: v.id("interviewSessions"),
    refinedTranscript: v.array(
      v.object({
        id: v.string(),
        interviewerQuestion: v.string(),
        smeResponse: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      refinedTranscript: args.refinedTranscript,
      updatedAt: Date.now(),
    });
  },
});

export const addDiagnostic = mutation({
  args: {
    sessionId: v.string(),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("diagnostics", {
      sessionId: args.sessionId,
      message: args.message,
      createdAt: Date.now(),
    });
  },
});

function createInitialWelcome(setting: {
  interviewerName: string;
  smeName: string;
  jobRoleTitle: string;
  domainIndustry: string;
  interviewObjective: string;
}) {
  return [
    "# Welcome to Capabara's AI-Assisted Interview Support Agent: The Silent Whisperer",
    "",
    "Thank you for using The Silent Whisperer, your off-mic, on-screen assistant for high-impact interviews.",
    "",
    "This tool delivers three main benefits:",
    "1. Tracking interview progress across the ACTA distribution.",
    "2. Real-time coaching with context-aware follow-up prompts.",
    "3. Transcript management for review, editing, and final archiving.",
    "",
    "## Objective",
    `Interview with ${setting.smeName}, ${setting.jobRoleTitle} (${setting.domainIndustry}).`,
    `Goal: ${setting.interviewObjective}`,
    "",
    "## Next Step",
    "I will conduct a pre-interview checklist to summarise the session metadata and extract key domain keywords.",
    "",
    "Please type `Proceed` to generate the Pre-Interview Checklist.",
  ].join("\n");
}
