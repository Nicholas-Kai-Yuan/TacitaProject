import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const actaLevel = v.union(v.literal("L1"), v.literal("L2"), v.literal("L3"));
const questionStatus = v.union(v.literal("planned"), v.literal("asked"), v.literal("skipped"));
const speaker = v.union(v.literal("interviewer"), v.literal("sme"), v.literal("unknown"));
const role = v.union(v.literal("it_admin"), v.literal("admin"), v.literal("interviewer"));

export default defineSchema({
  accounts: defineTable({
    username: v.string(),
    displayName: v.string(),
    role,
    passwordHash: v.string(),
    passwordSalt: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_username", ["username"])
    .index("by_role", ["role"]),

  interviewSettings: defineTable({
    interviewerName: v.string(),
    smeName: v.string(),
    jobRoleTitle: v.string(),
    domainIndustry: v.string(),
    jobDescription: v.string(),
    interviewObjective: v.string(),
    keyFocusAreas: v.string(),
    actaRatio: v.string(),
    assignedInterviewerAccountId: v.optional(v.id("accounts")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_createdAt", ["createdAt"]),

  interviewSessions: defineTable({
    settingId: v.id("interviewSettings"),
    interviewerAccountId: v.optional(v.id("accounts")),
    settingSnapshot: v.object({
      interviewerName: v.string(),
      smeName: v.string(),
      jobRoleTitle: v.string(),
      domainIndustry: v.string(),
      jobDescription: v.string(),
      interviewObjective: v.string(),
      keyFocusAreas: v.string(),
      actaRatio: v.string(),
      assignedInterviewerAccountId: v.optional(v.id("accounts")),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
    status: v.union(
      v.literal("draft"),
      v.literal("questions_generated"),
      v.literal("ready"),
      v.literal("in_progress"),
      v.literal("ended"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
    questionsApprovedAt: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    starterQuestions: v.array(
      v.object({
        id: v.string(),
        text: v.string(),
        actaLevel,
        focus: v.string(),
        status: questionStatus,
        source: v.union(v.literal("starter"), v.literal("follow_up")),
      }),
    ),
    transcriptSegments: v.array(
      v.object({
        id: v.string(),
        speaker,
        text: v.string(),
        createdAt: v.number(),
        submittedForAi: v.boolean(),
      }),
    ),
    followUpSuggestions: v.array(
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
    chatMessages: v.array(
      v.object({
        id: v.string(),
        role: v.union(v.literal("user"), v.literal("assistant")),
        content: v.string(),
        createdAt: v.number(),
      }),
    ),
    summary: v.optional(
      v.object({
        generatedAt: v.number(),
        taskMap: v.array(v.string()),
        tacitKnowledge: v.array(v.string()),
        scenarioFindings: v.array(v.string()),
        futureExploration: v.array(v.string()),
      }),
    ),
    refinedTranscript: v.optional(
      v.array(
        v.object({
          id: v.string(),
          interviewerQuestion: v.string(),
          smeResponse: v.string(),
        }),
      ),
    ),
  }).index("by_setting", ["settingId"]),

  diagnostics: defineTable({
    sessionId: v.string(),
    message: v.string(),
    createdAt: v.number(),
  }).index("by_session", ["sessionId"]),
});
