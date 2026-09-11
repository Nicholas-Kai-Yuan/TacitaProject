import { z } from "zod";
import { parseActaRatio } from "./acta";

export const interviewSettingInputSchema = z.object({
  interviewerName: z.string().trim().min(1, "Interviewer name is required"),
  smeName: z.string().trim().min(1, "SME name is required"),
  jobRoleTitle: z.string().trim().min(1, "Job role/title is required"),
  domainIndustry: z.string().trim().min(1, "Domain/industry is required"),
  jobDescription: z.string().trim().min(1, "Job description is required"),
  interviewObjective: z.string().trim().min(1, "Interview objective and purpose is required"),
  keyFocusAreas: z.string().trim().min(1, "Key focus areas are required"),
  actaRatio: z
    .string()
    .trim()
    .min(1, "ACTA ratio is required")
    .refine((value) => parseActaRatio(value) !== null, {
      message: "Use a valid ratio such as L1: 20%; L2: 60%; L3: 20%",
    }),
  assignedInterviewerAccountId: z.string().trim().min(1).nullable().optional(),
});

const usernameSchema = z
  .string()
  .trim()
  .min(3, "Username must be at least 3 characters")
  .regex(/^[a-zA-Z0-9._-]+$/, "Username may only contain letters, numbers, dots, underscores, and hyphens");

export const managedAccountInputSchema = z.object({
  username: usernameSchema,
  displayName: z.string().trim().min(1, "Display name is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  role: z.enum(["admin", "interviewer"]),
});

export const managedAccountUpdateSchema = z.object({
  username: usernameSchema,
  displayName: z.string().trim().min(1, "Display name is required"),
  password: z.string().min(6, "Password must be at least 6 characters").optional().or(z.literal("")),
  role: z.enum(["admin", "interviewer"]),
});

export const settingAccessInputSchema = z.object({
  interviewerAccountId: z.string().trim().min(1).nullable(),
});

export const transcriptSegmentInputSchema = z.object({
  speaker: z.enum(["interviewer", "sme", "unknown"]),
  text: z.string().trim().min(1, "Transcript text is required"),
  submittedForAi: z.boolean().optional(),
});

export const chatInputSchema = z.object({
  message: z.string().trim().min(1, "Message is required"),
});
