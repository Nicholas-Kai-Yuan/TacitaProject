import { generateObject, generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import {
  compactText,
  generateFallbackFollowUps,
  generateFallbackRefinedTranscript,
  generateFallbackStarterQuestions,
  generateFallbackSummary,
  getQuestionDistribution,
} from "../shared/acta";
import type {
  ActaLevel,
  FollowUpSuggestion,
  InterviewSession,
  InterviewSetting,
  InterviewSummary,
  RefinedTranscriptBlock,
  StarterQuestion,
} from "../shared/types";

const questionSchema = z.object({
  text: z.string().min(1),
  actaLevel: z.enum(["L1", "L2", "L3"]),
  focus: z.string().min(1),
});

const starterQuestionsSchema = z.object({
  questions: z.array(questionSchema).length(15),
});

const followUpsSchema = z.object({
  suggestions: z.array(
    z.object({
      text: z.string().min(1),
      actaLevel: z.enum(["L1", "L2", "L3"]),
      focus: z.string().min(1),
      rationale: z.string().min(1),
    }),
  ).min(1).max(5),
});

const summarySchema = z.object({
  taskMap: z.array(z.string()).min(1),
  tacitKnowledge: z.array(z.string()).min(1),
  scenarioFindings: z.array(z.string()).min(1),
  futureExploration: z.array(z.string()).min(1),
});

const refinedTranscriptSchema = z.object({
  blocks: z.array(
    z.object({
      interviewerQuestion: z.string().min(1),
      smeResponse: z.string().min(1),
    }),
  ),
});

const checklistSchema = z.object({
  domainKeywords: z.array(z.string().min(1)).min(3).max(7),
  expectedThemes: z.array(z.string().min(1)).min(5).max(5),
});

const ACTA_CONTEXT = [
  "Applied Cognitive Task Analysis (ACTA) uses three interview layers:",
  "L1 Task Diagram: map the work into 3 to 6 broad steps and identify cognitive hotspots.",
  "L2 Knowledge Audit: probe cues, diagnosing/predicting, big picture, noticing, job smarts, improvising, metacognition, anomalies, and tool limitations.",
  "L3 Simulation Interview: use difficult incidents or realistic scenarios to surface decision points, cues, trade-offs, novice errors, and expert reasoning.",
  "The final output should preserve questions, answers, follow-ups, transcript evidence, and a knowledge handover summary.",
].join("\n");

export function createInitialWelcome(setting: InterviewSetting): string {
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

export async function createPreInterviewChecklistReply(setting: InterviewSetting): Promise<string> {
  const checklist = await createChecklistData(setting);

  return [
    "## Pre-Interview Checklist",
    "",
    "| Field | Current Configuration |",
    "| :--- | :--- |",
    `| Objective and Context | ${escapeTableCell(setting.interviewObjective)} |`,
    `| Subject and Topics | ${escapeTableCell(setting.keyFocusAreas)} |`,
    `| Domain Keywords | ${escapeTableCell(checklist.domainKeywords.join(", "))} |`,
    `| Interviewer | ${escapeTableCell(setting.interviewerName)} |`,
    `| SME (Interviewee) | ${escapeTableCell(`${setting.smeName}, ${setting.jobRoleTitle}`)} |`,
    `| ACTA Target Ratio | ${escapeTableCell(renderActaRatio(setting))} |`,
    "",
    "### Expected Themes",
    ...checklist.expectedThemes.map((theme) => `- ${theme}`),
    "",
    "I have verified the session metadata and extracted key domain themes.",
    "Does this look correct? Please confirm to generate your Starter Questions.",
  ].join("\n");
}

export function createStarterQuestionFlowReply(session: InterviewSession): string {
  return [
    "Thank you for your confirmation.",
    "",
    renderSessionTracker(session),
    "",
    "## Question Queue (The 15-Q Funnel)",
    "",
    renderQuestionQueue(session),
    "",
    "## Follow-up Tracker (Dynamic)",
    "",
    renderFollowUpTracker(session),
    "",
    "## Transcription State Management Instructions",
    "",
    "- Capture the interviewer question and SME answer in the chat box below.",
    "- Send each Q&A exchange for AI analysis so I can update the tracker and suggest follow-ups.",
    "- You may ask your own questions, use the queue, or use a suggested follow-up.",
    "",
    "You may type `Mic On` whenever you are ready.",
    "",
    "## Next Logical Step",
    "Begin your interview with Question 1 from the queue to establish context and workflow.",
  ].join("\n");
}

export function createMicOnReply(session: InterviewSession): string {
  const activeQuestion = getActiveQuestion(session);
  return [
    "Mic On confirmed. The live interview is now in progress.",
    "",
    renderSessionTracker(session),
    "",
    "## Active Question",
    activeQuestion
      ? `Focus: ${activeQuestion.focus}\nACTA Target: ${activeQuestion.actaLevel}\n\n${activeQuestion.text}`
      : "All starter questions have been covered. Continue with targeted follow-ups or type `End` to close.",
    "",
    "Send the captured Q&A exchange after the SME answers so I can update the tracker and recommend the next move.",
  ].join("\n");
}

export async function createStarterQuestions(setting: InterviewSetting): Promise<StarterQuestion[]> {
  const distribution = getQuestionDistribution(setting.actaRatio);

  if (!hasOpenAiKey()) {
    return generateFallbackStarterQuestions(setting);
  }

  try {
    const result = await generateObject({
      model: openai(getModel()),
      schema: starterQuestionsSchema,
      prompt: [
        "Generate exactly 15 personalized ACTA-aligned starter interview questions.",
        "Questions must be ordered from L1 to L2 to L3, be specific to the SME, avoid duplicates, and not be yes/no questions.",
        `Required distribution: L1=${distribution.L1}, L2=${distribution.L2}, L3=${distribution.L3}.`,
        renderSetting(setting),
      ].join("\n\n"),
    });

    const questions = result.object.questions.map((question) => ({
      ...question,
      id: crypto.randomUUID(),
      status: "planned" as const,
      source: "starter" as const,
    }));

    return enforceQuestionDistribution(questions, setting);
  } catch (error) {
    console.warn("OpenAI starter question generation failed; using fallback.", error);
    return generateFallbackStarterQuestions(setting);
  }
}

export async function createFollowUps(session: InterviewSession): Promise<FollowUpSuggestion[]> {
  if (!hasOpenAiKey()) {
    return generateFallbackFollowUps(session.settingSnapshot, session.transcriptSegments);
  }

  try {
    const result = await generateObject({
      model: openai(getModel()),
      schema: followUpsSchema,
      prompt: [
        "Recommend a small set of concise ACTA follow-up questions for a live interviewer.",
        "Build on the latest SME response, avoid repetition, and favor explanation/storytelling over yes/no wording.",
        renderSetting(session.settingSnapshot),
        renderSessionContext(session),
      ].join("\n\n"),
    });

    return result.object.suggestions.map((suggestion, index) => ({
      ...suggestion,
      id: crypto.randomUUID(),
      createdAt: Date.now() + index,
      used: false,
    }));
  } catch (error) {
    console.warn("OpenAI follow-up generation failed; using fallback.", error);
    return generateFallbackFollowUps(session.settingSnapshot, session.transcriptSegments);
  }
}

export async function createSummary(session: InterviewSession): Promise<InterviewSummary> {
  if (!hasOpenAiKey()) {
    return generateFallbackSummary(session.settingSnapshot, session.transcriptSegments);
  }

  try {
    const result = await generateObject({
      model: openai(getModel()),
      schema: summarySchema,
      prompt: [
        "Generate a whole-interview ACTA summary from the complete transcript.",
        "Cover L1 task map/cognitive hotspots, L2 tacit expert knowledge, L3 scenario/decision findings, and future exploration.",
        "Do not summarize only the most recent segment.",
        renderSetting(session.settingSnapshot),
        renderSessionContext(session),
      ].join("\n\n"),
    });

    return {
      generatedAt: Date.now(),
      ...result.object,
    };
  } catch (error) {
    console.warn("OpenAI summary generation failed; using fallback.", error);
    return generateFallbackSummary(session.settingSnapshot, session.transcriptSegments);
  }
}

export async function createRefinedTranscript(
  session: InterviewSession,
): Promise<RefinedTranscriptBlock[]> {
  if (!hasOpenAiKey()) {
    return generateFallbackRefinedTranscript(session.transcriptSegments);
  }

  try {
    const result = await generateObject({
      model: openai(getModel()),
      schema: refinedTranscriptSchema,
      prompt: [
        "Create a refined speaker-labelled transcript arranged into interviewer-question and SME-response blocks.",
        "Use only the provided transcript content.",
        renderSessionContext(session),
      ].join("\n\n"),
    });

    return result.object.blocks.map((block) => ({
      ...block,
      id: crypto.randomUUID(),
    }));
  } catch (error) {
    console.warn("OpenAI refined transcript generation failed; using fallback.", error);
    return generateFallbackRefinedTranscript(session.transcriptSegments);
  }
}

export async function createChatReply(
  session: InterviewSession,
  message: string,
): Promise<string> {
  if (!hasOpenAiKey()) {
    if (session.starterQuestions.length === 0) {
      return "I am ready to begin the guided ACTA setup. Type `Proceed` to generate the Pre-Interview Checklist.";
    }

    const latest = session.transcriptSegments.at(-1)?.text;
    return [
      "Based on the current session context, keep the interviewer in control and probe for tacit knowledge.",
      latest
        ? `A useful next move is to ask what cues or trade-offs sit behind: "${latest.slice(0, 160)}".`
        : "Generate or capture transcript content first for more contextual guidance.",
    ].join(" ");
  }

  try {
    const result = await generateText({
      model: openai(getModel()),
      prompt: [
        "You are TACITA, an interviewer-facing ACTA copilot called The Silent Whisperer.",
        "Answer concisely and only support the human interviewer. Do not pretend to be the SME.",
        ACTA_CONTEXT,
        renderSetting(session.settingSnapshot),
        renderSessionContext(session),
        `Interviewer asks: ${message}`,
      ].join("\n\n"),
    });

    return result.text;
  } catch (error) {
    console.warn("OpenAI chat failed; using fallback.", error);
    return "I could not reach the AI provider, so I would continue by probing for cues, decision points, trade-offs, and what a novice might miss.";
  }
}

export async function createLiveInterviewTurnReply(
  session: InterviewSession,
  latestInput: string,
): Promise<string> {
  const coaching = await createCoachingText(session, latestInput);

  return [
    renderSessionTracker(session),
    "",
    "## Active Question",
    renderActiveQuestion(session),
    "",
    "## Question Queue (The 15-Q Funnel)",
    "",
    renderQuestionQueue(session),
    "",
    "## Follow-up Tracker (Dynamic)",
    "",
    renderFollowUpTracker(session),
    "",
    "## AI Coaching",
    coaching,
    "",
    "## Next Logical Step",
    getNextLogicalStep(session),
  ].join("\n");
}

export function createEndInterviewReply(session: InterviewSession, summary: InterviewSummary): string {
  const asked = session.starterQuestions.filter((question) => question.status === "asked").length;

  return [
    "Conclusion detected. I have ended the interview and stored the full chat log, starter questions, follow-up suggestions, and captured transcript in Convex.",
    "",
    `Questions covered: ${asked} / ${Math.max(session.starterQuestions.length, 15)}.`,
    "",
    "## Final Summary",
    "",
    "### L1 Task Map and Cognitive Hotspots",
    ...summary.taskMap.map((item) => `- ${item}`),
    "",
    "### L2 Tacit Expert Knowledge",
    ...summary.tacitKnowledge.map((item) => `- ${item}`),
    "",
    "### L3 Scenario / Incident Analysis",
    ...summary.scenarioFindings.map((item) => `- ${item}`),
    "",
    "### Future Exploration",
    ...summary.futureExploration.map((item) => `- ${item}`),
  ].join("\n");
}

export function hasPreInterviewChecklist(session: InterviewSession): boolean {
  return session.chatMessages.some(
    (message) => message.role === "assistant" && message.content.includes("Pre-Interview Checklist"),
  );
}

export function isProceedCommand(message: string): boolean {
  return normalizeCommand(message) === "proceed";
}

export function isConfirmationCommand(message: string): boolean {
  const normalized = normalizeCommand(message);
  return [
    "yes",
    "yes proceed",
    "proceed",
    "confirm",
    "confirmed",
    "looks good",
    "looks correct",
    "ok proceed",
    "okay proceed",
  ].includes(normalized);
}

export function isStartInterviewCommand(message: string): boolean {
  const normalized = normalizeCommand(message);
  return ["mic on", "start", "start interview", "begin", "begin interview"].includes(normalized);
}

export function isEndInterviewCommand(message: string): boolean {
  return normalizeCommand(message) === "end";
}

function enforceQuestionDistribution(
  questions: StarterQuestion[],
  setting: InterviewSetting,
): StarterQuestion[] {
  const distribution = getQuestionDistribution(setting.actaRatio);
  const fallback = generateFallbackStarterQuestions(setting);
  const ordered: StarterQuestion[] = [];

  for (const level of ["L1", "L2", "L3"] as ActaLevel[]) {
    const selected = questions.filter((question) => question.actaLevel === level);
    const needed = distribution[level];
    const filled = [...selected, ...fallback.filter((question) => question.actaLevel === level)]
      .slice(0, needed)
      .map((question) => ({
        ...question,
        id: crypto.randomUUID(),
        actaLevel: level,
        status: "planned" as const,
        source: "starter" as const,
      }));
    ordered.push(...filled);
  }

  return ordered.slice(0, 15);
}

function renderSetting(setting: InterviewSetting): string {
  return [
    `Interviewer: ${setting.interviewerName}`,
    `SME: ${setting.smeName}`,
    `Role: ${setting.jobRoleTitle}`,
    `Domain/Industry: ${setting.domainIndustry}`,
    `Job Description: ${setting.jobDescription}`,
    `Interview Objective: ${setting.interviewObjective}`,
    `Key Focus Areas: ${setting.keyFocusAreas}`,
    `ACTA Ratio: ${setting.actaRatio}`,
  ].join("\n");
}

async function createChecklistData(setting: InterviewSetting): Promise<z.infer<typeof checklistSchema>> {
  if (!hasOpenAiKey()) {
    return createFallbackChecklistData(setting);
  }

  try {
    const result = await generateObject({
      model: openai(getModel()),
      schema: checklistSchema,
      prompt: [
        "Create concise pre-interview checklist support data for an ACTA interview.",
        "Return 5 to 7 domain keywords and exactly 5 expected themes. Use only the provided interview setting.",
        ACTA_CONTEXT,
        renderSetting(setting),
      ].join("\n\n"),
    });

    return {
      domainKeywords: result.object.domainKeywords.map(cleanListItem).filter(Boolean).slice(0, 7),
      expectedThemes: fillToFive(result.object.expectedThemes.map(cleanListItem).filter(Boolean), setting),
    };
  } catch (error) {
    console.warn("OpenAI checklist generation failed; using fallback.", error);
    return createFallbackChecklistData(setting);
  }
}

async function createCoachingText(session: InterviewSession, latestInput: string): Promise<string> {
  if (!hasOpenAiKey()) {
    return createFallbackCoachingText(session, latestInput);
  }

  try {
    const result = await generateText({
      model: openai(getModel()),
      prompt: [
        "You are TACITA's Silent Whisperer, an off-mic ACTA interview coach.",
        "Write a concise coaching note for the interviewer. Mention why the latest answer matters, what ACTA layer it supports, and how to probe deeper.",
        "Keep it under 140 words. Do not repeat the full transcript.",
        ACTA_CONTEXT,
        renderSetting(session.settingSnapshot),
        renderSessionContext(session),
        `Latest submitted interview content: ${latestInput}`,
      ].join("\n\n"),
    });

    return result.text.trim() || createFallbackCoachingText(session, latestInput);
  } catch (error) {
    console.warn("OpenAI live coaching failed; using fallback.", error);
    return createFallbackCoachingText(session, latestInput);
  }
}

function renderSessionContext(session: InterviewSession): string {
  const questions = session.starterQuestions
    .map((question) => `[${question.actaLevel}/${question.status}] ${question.text}`)
    .join("\n");
  const transcript = session.transcriptSegments
    .map((segment) => `${segment.speaker}: ${segment.text}`)
    .join("\n");
  const suggestions = session.followUpSuggestions
    .slice(0, 8)
    .map((suggestion) => `[${suggestion.actaLevel}] ${suggestion.text}`)
    .join("\n");

  return [
    "Starter and follow-up questions:",
    questions || "None yet.",
    "Transcript:",
    transcript || "None yet.",
    "Recent suggestions:",
    suggestions || "None yet.",
  ].join("\n");
}

function createFallbackChecklistData(setting: InterviewSetting): z.infer<typeof checklistSchema> {
  const keywords = uniqueClean([
    ...splitTextParts(setting.domainIndustry),
    ...splitTextParts(setting.keyFocusAreas),
    setting.jobRoleTitle,
  ]).slice(0, 7);

  const domainKeywords = keywords.length >= 3
    ? keywords
    : fillList(keywords, ["Tacit knowledge", "Decision-making", "Expert reasoning"]);

  return {
    domainKeywords,
    expectedThemes: fillToFive(
      uniqueClean([
        ...splitTextParts(setting.keyFocusAreas),
        `Cognitive hotspots in ${setting.jobRoleTitle}`,
        `Decision-making in ${setting.domainIndustry}`,
        "Tacit cues and expert heuristics",
        "Novice mistakes and knowledge transfer",
      ]),
      setting,
    ),
  };
}

function renderActaRatio(setting: InterviewSetting): string {
  const distribution = getQuestionDistribution(setting.actaRatio);
  return `${setting.actaRatio} | L1: ${distribution.L1}, L2: ${distribution.L2}, L3: ${distribution.L3}`;
}

function renderSessionTracker(session: InterviewSession): string {
  const target = getQuestionDistribution(session.settingSnapshot.actaRatio);
  const asked = countAskedByLevel(session);
  const totalAsked = asked.L1 + asked.L2 + asked.L3;

  return [
    "## Session Tracker",
    "",
    `Questions Asked: ${totalAsked} / 15 | Distribution: L1(${asked.L1}) L2(${asked.L2}) L3(${asked.L3})`,
    "",
    "| ACTA Level | Asked | Target | Status |",
    "| :--- | :--- | :--- | :--- |",
    ...(["L1", "L2", "L3"] as ActaLevel[]).map((level) => {
      const status = asked[level] >= target[level] ? "Target met" : "Open";
      return `| ${level} | ${asked[level]} | ${target[level]} | ${status} |`;
    }),
  ].join("\n");
}

function renderQuestionQueue(session: InterviewSession): string {
  if (session.starterQuestions.length === 0) {
    return "No starter questions have been generated yet.";
  }

  return [
    "| # | Focus | Question Text / Topic | ACTA Target | Status |",
    "| :--- | :--- | :--- | :--- | :--- |",
    ...session.starterQuestions.slice(0, 15).map((question, index) =>
      `| ${index + 1} | ${escapeTableCell(question.focus)} | ${escapeTableCell(question.text)} | ${question.actaLevel} | ${toTitle(question.status)} |`,
    ),
  ].join("\n");
}

function renderFollowUpTracker(session: InterviewSession): string {
  const visibleSuggestions = session.followUpSuggestions.slice(0, 5);

  if (visibleSuggestions.length === 0) {
    return [
      "| Ref | Suggested Follow-up | ACTA Level | Status |",
      "| :--- | :--- | :--- | :--- |",
      "| - | No follow-ups yet. Start the interview to receive real-time guidance. | - | - |",
    ].join("\n");
  }

  return [
    "| Ref | Suggested Follow-up | ACTA Level | Status |",
    "| :--- | :--- | :--- | :--- |",
    ...visibleSuggestions.map((suggestion) =>
      `| NEW | ${escapeTableCell(`[${suggestion.focus}] ${suggestion.text}`)} | ${suggestion.actaLevel} | ${suggestion.used ? "Used" : "Suggested"} |`,
    ),
  ].join("\n");
}

function renderActiveQuestion(session: InterviewSession): string {
  const activeQuestion = getActiveQuestion(session);
  if (!activeQuestion) {
    return "All starter questions are marked as covered. Use a follow-up suggestion or type `End` to close the session.";
  }

  return [
    `Focus: ${activeQuestion.focus}`,
    `ACTA Target: ${activeQuestion.actaLevel}`,
    "",
    activeQuestion.text,
  ].join("\n");
}

function getActiveQuestion(session: InterviewSession): StarterQuestion | undefined {
  return session.starterQuestions.find((question) => question.status === "planned");
}

function getNextLogicalStep(session: InterviewSession): string {
  const activeQuestion = getActiveQuestion(session);
  if (activeQuestion) {
    const index = session.starterQuestions.findIndex((question) => question.id === activeQuestion.id) + 1;
    return `You may proceed to Question ${index} or select one of the follow-ups above if the SME's answer needs more depth.`;
  }

  return "All starter questions have been covered. Ask a final meta-reflection question, then type `End` when ready.";
}

function createFallbackCoachingText(session: InterviewSession, latestInput: string): string {
  const activeQuestion = getActiveQuestion(session);
  const compactInput = compactText(latestInput, 180);

  return [
    `Rationale: The latest exchange gives usable evidence for ACTA probing: "${compactInput}".`,
    activeQuestion
      ? `Probe for the cues, trade-offs, and novice misunderstandings behind this answer before moving to: ${activeQuestion.text}`
      : "Coverage is broad enough for a closing reflection. Ask what separates an expert decision from a good guess in this work.",
  ].join("\n");
}

function countAskedByLevel(session: InterviewSession): Record<ActaLevel, number> {
  return (["L1", "L2", "L3"] as ActaLevel[]).reduce<Record<ActaLevel, number>>(
    (counts, level) => {
      counts[level] = session.starterQuestions.filter(
        (question) => question.actaLevel === level && question.status === "asked",
      ).length;
      return counts;
    },
    { L1: 0, L2: 0, L3: 0 },
  );
}

function hasOpenAiKey(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function getModel(): string {
  return process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
}

function splitTextParts(value: string): string[] {
  return value
    .split(/[\n,;]+|\s+-\s+|\d+\.\s+/)
    .map(cleanListItem)
    .filter((part) => part.length > 2);
}

function cleanListItem(value: string): string {
  return value
    .replace(/^[\s:.\-()[\]]+/, "")
    .replace(/[\s:.\-()[\]]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueClean(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values.map(cleanListItem)) {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(value);
  }

  return result;
}

function fillToFive(values: string[], setting: InterviewSetting): string[] {
  return fillList(uniqueClean(values), [
    `Expert decision-making for ${setting.jobRoleTitle}`,
    `Cognitive cues within ${setting.domainIndustry}`,
    `Trade-offs and judgement under uncertainty`,
    "Tacit heuristics and job smarts",
    "Novice errors and onboarding risks",
  ]).slice(0, 5);
}

function fillList(values: string[], fallback: string[]): string[] {
  return uniqueClean([...values, ...fallback]);
}

function escapeTableCell(value: string): string {
  return compactText(value.replace(/\|/g, "/"), 360);
}

function normalizeCommand(message: string): string {
  return message
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ");
}

function toTitle(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
