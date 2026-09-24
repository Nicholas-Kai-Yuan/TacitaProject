import { generateObject, generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { getQuestionDistribution, parseActaRatio } from "../shared/acta";
import type {
  ActaLevel,
  ChatMessage,
  FollowUpSuggestion,
  InterviewSession,
  InterviewSetting,
  InterviewSummary,
  RefinedTranscriptBlock,
  StarterQuestion,
} from "../shared/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AGENT_SYSTEM_PROMPT = readFileSync(
  path.join(__dirname, "prompts", "silent-whisperer.md"),
  "utf-8",
);

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

export function describeAiError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requireOpenAiKey(): void {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new Error("OPENAI_API_KEY is not configured on the server.");
  }
}

function getModel(): string {
  return process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
}

function buildSystemPrompt(setting: InterviewSetting): string {
  const fields: Record<string, string> = {
    field1: setting.interviewerName,
    field2: setting.smeName,
    field3: setting.jobRoleTitle,
    field4: setting.domainIndustry,
    field5: setting.jobDescription,
    field6: setting.interviewObjective,
    field7: setting.keyFocusAreas,
    field8: setting.actaRatio,
  };

  return AGENT_SYSTEM_PROMPT.split("\n")
    .map((line) => {
      const inTableRow = line.trimStart().startsWith("|");
      return line.replace(/\{(field[1-8])\}/g, (_match, key: string) =>
        inTableRow ? toTableCell(fields[key]) : fields[key],
      );
    })
    .join("\n");
}

const LIST_BULLET = /^(?:[-*•·]\s+|[-•·](?=\D))/;
const NUMBERED_ITEM = /^\d+[.)]\s/;

// Raw newlines would split a markdown table row, so list lines become "• item" entries and wrapped lines rejoin.
function toTableCell(value: string): string {
  const entries: string[] = [];
  let canContinue = false;

  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      canContinue = false;
      continue;
    }

    const bullet = LIST_BULLET.exec(line);
    if (bullet) {
      entries.push(`• ${line.slice(bullet[0].length)}`);
    } else if (canContinue && !NUMBERED_ITEM.test(line)) {
      entries[entries.length - 1] += ` ${line}`;
    } else {
      entries.push(line);
    }
    canContinue = true;
  }

  return entries.join("<br>").replaceAll("|", "\\|");
}

export async function generateWelcomeReply(setting: InterviewSetting): Promise<string> {
  requireOpenAiKey();

  const result = await generateText({
    model: openai(getModel()),
    system: buildSystemPrompt(setting),
    prompt: "Begin the session now, following your Session Start Instruction exactly.",
  });

  return result.text;
}

export async function generateChatReply(
  setting: InterviewSetting,
  history: ChatMessage[],
  userMessage: string,
): Promise<string> {
  requireOpenAiKey();

  const result = await generateText({
    model: openai(getModel()),
    system: buildSystemPrompt(setting),
    messages: [
      ...toModelMessages(history),
      { role: "user", content: withSentStamp(userMessage, Date.now()) } as const,
    ],
  });

  return enforceQuestionQueue(result.text, history, userMessage);
}

const END_COMMAND = /^(?:end|done)(?:\s+(?:the\s+)?(?:interview|session))?[\s.!]*$/i;

export function isEndCommand(message: string): boolean {
  return END_COMMAND.test(message.trim());
}

const interviewSummarySchema = z.object({
  questionLog: z
    .array(
      z.object({
        messageNumber: z.number().int().describe("Number of the interviewer message that contains the question"),
        questionText: z.string().min(1).describe("The question in the interviewer's own words"),
        actaLevel: z.enum(["L1", "L2", "L3"]),
      }),
    )
    .describe("Every question the interviewer asked that the SME answered; one message can contain several questions"),
  macroSteps: z.array(z.string()).describe("Major steps or phases of the work the SME described, typically 3-6"),
  cognitiveHotspots: z
    .array(z.string())
    .describe("Steps or situations the SME said need the most judgement, experience, or problem-solving"),
  tacitExpertCategories: z
    .array(
      z.object({
        category: z.string().min(1).describe("Knowledge Audit category name, combining overlapping categories"),
        points: z
          .array(z.string())
          .describe("Specific cues, strategies, rules of thumb, workarounds, or anomalies the SME described"),
      }),
    )
    .describe("One entry per Knowledge Audit category the SME's answers covered; never empty when any L2 question was answered"),
  scenario: z.object({
    contextType: z.enum(["Real Incident", "Role-Specific Scenario"]),
    context: z.array(z.string()).describe("The scenario presented or the real incident the SME recalled"),
    majorEventsAndDecisionPoints: z.array(z.string()),
    situationAssessmentAndCriticalCues: z.array(z.string()),
    actionsTaken: z.array(z.string()),
    potentialNoviceErrors: z.array(z.string()),
  }),
  unresolvedCognitiveGaps: z
    .array(z.string())
    .describe("Reasoning the SME could not fully articulate, topics worth probing further, and focus areas or ACTA levels left uncovered"),
});

type InterviewSummaryData = z.infer<typeof interviewSummarySchema>;

// The model supplies the content; the inventory maths and layout are done here so counts always match the log.
export async function generateInterviewSummaryReply(
  setting: InterviewSetting,
  history: ChatMessage[],
): Promise<string> {
  requireOpenAiKey();

  const interviewerMessages = history.filter((message) => message.role === "user");
  const result = await generateObject({
    model: openai(getModel()),
    schema: interviewSummarySchema,
    system: buildSystemPrompt(setting),
    messages: [
      ...toModelMessages(history),
      {
        role: "user",
        content: [
          "The interviewer has ended the interview. Compile the Phase B End of Interview Summary data from the whole conversation, following the Phase B rules in your instructions.",
          "For the question log, go through the numbered interviewer messages below one at a time and record every question asked in each message that the SME answered, citing the message number. A message often contains several question-and-answer pairs; record each question separately. Skip messages that are only commands.",
          ...interviewerMessages.map((message, index) => `[Message ${index + 1}]\n${message.content}`),
        ].join("\n\n"),
      },
    ],
  });

  return renderInterviewSummary(setting, interviewerMessages, history, result.object);
}

const ACTA_TAGS: Record<ActaLevel, string> = {
  L1: "[ L1: TASK DIAGRAM ]",
  L2: "[ L2: KNOWLEDGE AUDIT ]",
  L3: "[ L3: SIMULATION ]",
};

function renderInterviewSummary(
  setting: InterviewSetting,
  interviewerMessages: ChatMessage[],
  history: ChatMessage[],
  summary: InterviewSummaryData,
): string {
  const ratio = parseActaRatio(setting.actaRatio) ?? { L1: 20, L2: 60, L3: 20 };
  const targetCounts = getQuestionDistribution(setting.actaRatio);
  const queueRows = referenceQueue(history);
  const followUps = suggestedFollowUps(history.filter((message) => message.role === "assistant"));
  const log = [...summary.questionLog]
    .sort((a, b) => a.messageNumber - b.messageNumber)
    .map((question) => ({ ...question, ...classifyQuestion(question.questionText, question.actaLevel, queueRows, followUps) }));

  // Target # is the level's share of the 15-question funnel (e.g. 60% of 15 = 9 L2 questions).
  const inventoryRows = (Object.keys(ACTA_TAGS) as ActaLevel[]).map((level) => {
    const count = log.filter((question) => question.level === level).length;
    const target = targetCounts[level];
    return `| \`${ACTA_TAGS[level]}\` | ${ratio[level]}% | ${count} / ${target} | ${inventoryStatus(count, target)} |`;
  });

  const logRows = log.map((question) => {
    const sourceMessage = interviewerMessages[question.messageNumber - 1];
    const time = sourceMessage ? formatGmt8(sourceMessage.createdAt).slice(-5) : "N/A";
    return `| ${time} | ${question.type} | ${toTableCell(question.questionText)} | \`[${question.level}]\` |`;
  });

  const { scenario } = summary;
  const tacitExpert = summary.tacitExpertCategories.length
    ? summary.tacitExpertCategories.map(({ category, points }) => labelledList(category, points))
    : [bulletList([])];

  return [
    "## END OF INTERVIEW SUMMARY",
    "### Final ACTA Inventory",
    markdownTable(["Level", "Target %", "Actual # / Target #", "Status"], inventoryRows),
    "---",
    "### Tacit Knowledge Handover Report",
    "**1. The Task Map & Hotspots (L1):**",
    labelledList("Macro Steps", summary.macroSteps),
    labelledList("Cognitive Hotspots", summary.cognitiveHotspots),
    "---",
    "**2. The Tacit Expert (L2):**",
    ...tacitExpert,
    "---",
    "**3. Scenario & Incident Breakdown (L3):**",
    labelledList(`Context (${scenario.contextType})`, scenario.context),
    labelledList("Major Events & Decision Points", scenario.majorEventsAndDecisionPoints),
    labelledList("Situation Assessment & Critical Cues", scenario.situationAssessmentAndCriticalCues),
    labelledList("Actions Taken", scenario.actionsTaken),
    labelledList("Potential Errors (Novice Traps)", scenario.potentialNoviceErrors),
    "---",
    "### Areas for Future Exploration",
    labelledList("Unresolved Cognitive Gaps", summary.unresolvedCognitiveGaps),
    "---",
    "**✅ Validated Questions Asked (Complete Log)**",
    markdownTable(
      ["Timestamp (GMT+8)", "Type (Starter / Follow-up / Off-Script)", "Question Text", "ACTA Level"],
      logRows.length ? logRows : ["| N/A | - | No validated questions were recorded. | - |"],
    ),
    "---",
    "**Would you like me to generate the Final Refined Transcript & Q&A Chunking?** Type **'Confirm'** to proceed.",
    "*Depending on the interview length, generating all interaction blocks may take a few more turns.*",
  ].join("\n\n");
}

// Classified here rather than by the model, which proved unreliable at recognising its own funnel and suggestions.
// A starter question keeps the level it was given in the queue so the inventory matches the queue.
function classifyQuestion(
  question: string,
  modelLevel: ActaLevel,
  queueRows: QueueRow[],
  followUps: string[],
): { type: string; level: ActaLevel } {
  let best: QueueRow | null = null;
  let bestScore = 0;
  for (const row of queueRows) {
    const score = phraseOverlap(row.question, question);
    if (score > bestScore) {
      best = row;
      bestScore = score;
    }
  }
  if (best && bestScore >= ASKED_THRESHOLD) {
    return { type: "Starter", level: best.level ?? modelLevel };
  }

  const isFollowUp = followUps.some((suggested) => questionSimilarity(question, suggested) >= 0.5);
  return { type: isFollowUp ? "Follow-up" : "Off-Script", level: modelLevel };
}

interface QueueRow {
  cells: string[];
  question: string;
  level: ActaLevel | null;
}

interface QueueTable {
  header: string[];
  rows: QueueRow[];
}

// The model redraws the "15-Q Funnel" table every turn and, left alone, reshuffles rows, drops answered ones,
// or swaps in follow-ups. Once the live interview starts (first reply with a SESSION TRACKER) every reply
// gets the approved queue back, with statuses worked out from the transcripts.
function enforceQuestionQueue(reply: string, history: ChatMessage[], latestMessage: string): string {
  const lines = reply.split(/\r?\n/);
  const range = findQueueTable(lines);
  const now = Date.now();
  const messages: ChatMessage[] = [
    ...history,
    { id: "latest", role: "user", content: latestMessage, createdAt: now },
    { id: "reply", role: "assistant", content: reply, createdAt: now },
  ];
  const approved = approvedQueue(messages);
  if (!range || !approved) {
    return reply;
  }

  // Every transcript since the approved queue counts, so an answer sent before the first tracker is
  // included and Done never reverts.
  const transcripts = messages
    .slice(approved.index + 1)
    .filter((message) => message.role === "user")
    .map((message) => message.content);
  const activeQuestion = readQueueTable(reply)?.rows.find((row) => /active/i.test(row.cells.at(-1) ?? ""))?.question;

  const rows = approved.table.rows.map((row) => {
    let status = "Pending";
    if (transcripts.some((transcript) => phraseOverlap(row.question, transcript) >= ASKED_THRESHOLD)) {
      status = "Done";
    } else if (activeQuestion && phraseOverlap(row.question, activeQuestion) >= ASKED_THRESHOLD) {
      status = "Active";
    }
    return `| ${[...row.cells.slice(0, -1), status].join(" | ")} |`;
  });

  return [...lines.slice(0, range.start), ...approved.table.header, ...rows, ...lines.slice(range.end)].join("\n");
}

// Null until the live interview has started. The approved queue is the last one shown before the first
// SESSION TRACKER, or that message's own queue when the model went straight to the live format.
function approvedQueue(messages: ChatMessage[]): { index: number; table: QueueTable } | null {
  const liveIndex = messages.findIndex(
    (message) => message.role === "assistant" && message.content.includes("SESSION TRACKER") && readQueueTable(message.content),
  );
  if (liveIndex < 0) {
    return null;
  }

  for (let index = liveIndex - 1; index >= 0; index -= 1) {
    const table = messages[index].role === "assistant" ? readQueueTable(messages[index].content) : null;
    if (table) {
      return { index, table };
    }
  }
  const table = readQueueTable(messages[liveIndex].content);
  return table ? { index: liveIndex, table } : null;
}

// The approved queue if the interview has started, otherwise the most recent queue shown.
function referenceQueue(history: ChatMessage[]): QueueRow[] {
  const approved = approvedQueue(history);
  if (approved) {
    return approved.table.rows;
  }
  const latest = [...history].reverse().find((message) => message.role === "assistant" && readQueueTable(message.content));
  return latest ? readQueueTable(latest.content)?.rows ?? [] : [];
}

function readQueueTable(content: string): QueueTable | null {
  const lines = content.split(/\r?\n/);
  const range = findQueueTable(lines);
  if (!range) {
    return null;
  }

  const tableLines = lines.slice(range.start, range.end).map((line) => line.trim());
  const rows = tableLines
    .filter((line) => /^\|\s*\d/.test(line))
    .map(parseQueueRow)
    .sort((a, b) => Number.parseInt(a.cells[0], 10) - Number.parseInt(b.cells[0], 10));
  return rows.length ? { header: tableLines.filter((line) => !/^\|\s*\d/.test(line)), rows } : null;
}

// The table directly under a line mentioning the "15-Q Funnel" (blank lines in between are allowed).
function findQueueTable(lines: string[]): { start: number; end: number } | null {
  for (let heading = 0; heading < lines.length; heading += 1) {
    if (!lines[heading].includes("15-Q Funnel")) {
      continue;
    }

    let start = -1;
    let end = heading + 1;
    for (; end < lines.length; end += 1) {
      const line = lines[end].trim();
      if (line.startsWith("|")) {
        start = start < 0 ? end : start;
      } else if (line || start >= 0) {
        break;
      }
    }
    if (start >= 0) {
      return { start, end };
    }
  }
  return null;
}

function parseQueueRow(line: string): QueueRow {
  const cells = line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());
  const question = cells.reduce((longest, cell) => (cell.length > longest.length ? cell : longest), "");
  const level = /\bL([123])\b/.exec(cells.filter((cell) => cell !== question).join(" "))?.[1];
  return { cells, question, level: level ? (`L${level}` as ActaLevel) : null };
}

const ASKED_THRESHOLD = 0.5;

// Share of the queued question's consecutive word pairs found in the text. Word pairs survive missing
// punctuation from speech-to-text, but an answer that merely discusses the same topic rarely repeats them.
function phraseOverlap(queuedQuestion: string, text: string): number {
  const questionPairs = new Set(wordPairs(queuedQuestion));
  if (questionPairs.size === 0) {
    return 0;
  }
  const textPairs = new Set(wordPairs(text));
  return [...questionPairs].filter((pair) => textPairs.has(pair)).length / questionPairs.size;
}

function wordPairs(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
  return words.slice(1).map((word, index) => `${words[index]} ${word}`);
}

// Follow-up scripts are always presented as quoted questions.
function suggestedFollowUps(assistantMessages: ChatMessage[]): string[] {
  return assistantMessages.flatMap((message) =>
    [...message.content.matchAll(/["“]([^"”\n]{10,})["”]/g)]
      .map((match) => match[1].trim())
      .filter((quoted) => quoted.endsWith("?")),
  );
}

const STOP_WORDS = new Set([
  "about", "been", "could", "does", "from", "have", "into", "more", "most", "some", "that", "their",
  "them", "there", "these", "they", "this", "those", "were", "what", "when", "which", "with", "would", "your",
]);

// Share of the shorter question's key words found in the other; 0.5 or more is treated as the same question.
function questionSimilarity(asked: string, reference: string): number {
  const askedWords = contentWords(asked);
  const referenceWords = contentWords(reference);
  const shared = [...askedWords].filter((word) => referenceWords.has(word)).length;
  return shared >= 2 ? shared / Math.min(askedWords.size, referenceWords.size) : 0;
}

function contentWords(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((word) => !STOP_WORDS.has(word)));
}

function inventoryStatus(count: number, target: number): "Under" | "Met" | "Over" {
  if (count === target) {
    return "Met";
  }
  return count < target ? "Under" : "Over";
}

function markdownTable(header: string[], rows: string[]): string {
  return [`| ${header.join(" | ")} |`, `| ${header.map(() => ":---").join(" | ")} |`, ...rows].join("\n");
}

function labelledList(label: string, items: string[]): string {
  return `*${label.replaceAll("*", "").trim()}:*\n\n${bulletList(items)}`;
}

function bulletList(items: string[]): string {
  const lines = items.map((item) => item.replace(/\s+/g, " ").trim()).filter(Boolean);
  return lines.length ? lines.map((line) => `- ${line}`).join("\n") : "- Not covered in this interview.";
}

function toModelMessages(history: ChatMessage[]) {
  return history.map((message) =>
    message.role === "user"
      ? ({ role: "user", content: withSentStamp(message.content, message.createdAt) } as const)
      : ({ role: "assistant", content: message.content } as const),
  );
}

const gmt8Format = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Singapore",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function formatGmt8(timestamp: number): string {
  const part = Object.fromEntries(gmt8Format.formatToParts(timestamp).map(({ type, value }) => [type, value]));
  return `${part.year}-${part.month}-${part.day} ${part.hour}:${part.minute}`;
}

function withSentStamp(content: string, timestamp: number): string {
  return `[Sent ${formatGmt8(timestamp)} GMT+8]\n${content}`;
}

export async function createStarterQuestions(setting: InterviewSetting): Promise<StarterQuestion[]> {
  requireOpenAiKey();

  const distribution = getQuestionDistribution(setting.actaRatio);
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

  return result.object.questions.map((question) => ({
    ...question,
    id: crypto.randomUUID(),
    status: "planned" as const,
    source: "starter" as const,
  }));
}

export async function createFollowUps(session: InterviewSession): Promise<FollowUpSuggestion[]> {
  requireOpenAiKey();

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
}

export async function createSummary(session: InterviewSession): Promise<InterviewSummary> {
  requireOpenAiKey();

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
}

export async function createRefinedTranscript(
  session: InterviewSession,
): Promise<RefinedTranscriptBlock[]> {
  requireOpenAiKey();

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
