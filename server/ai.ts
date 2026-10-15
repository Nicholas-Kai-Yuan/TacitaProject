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
// The tool's hidden first user prompt; it produces the welcome message.
const FIRST_MESSAGE_PROMPT = readFileSync(
  path.join(__dirname, "prompts", "first-message.md"),
  "utf-8",
);

const KNOWLEDGE_AUDIT_CATEGORIES = [
  "Past & Future",
  "Big Picture",
  "Noticing",
  "Job Smarts",
  "Opportunities / Improvising",
  "Self-Monitoring",
  "Anomalies",
  "Equipment Difficulties",
] as const;

// The blueprint is filled before any question so each one is written from what the setup actually says,
// and the per-level arrays hold the queue to the configured ACTA split.
function questionFunnelSchema(counts: Record<ActaLevel, number>) {
  return z.object({
    blueprint: z.object({
      workElements: z
        .array(z.string())
        .describe("Concrete responsibilities, decisions and activities named in the SME Job Description, in its own wording"),
      focusAreaElements: z.array(z.string()).describe("Every distinct focus area and sub-topic named in the Key Focus Areas"),
      tensions: z
        .array(z.string())
        .describe("Competing goals, trade-offs and risks named in or directly implied by the Interview Objective and Job Description"),
      criticalSituations: z
        .array(z.string())
        .describe("Conditions named in or directly implied by the setup under which the work becomes hard"),
    }),
    l1: z
      .array(
        z.object({
          angle: z.string().describe("The part of the task diagram this question maps that no other L1 question covers"),
          question: z.string().min(1),
        }),
      )
      .length(counts.L1),
    l2: z
      .array(
        z.object({
          category: z.enum(KNOWLEDGE_AUDIT_CATEGORIES),
          anchor: z
            .string()
            .describe("The focus area element and the work element, tension or situation this question is built on"),
          question: z.string().min(1),
        }),
      )
      .length(counts.L2),
    l3: z
      .array(
        z.object({
          scenarioType: z.enum(["Real Incident", "Hypothetical"]),
          anchor: z.string().describe("The focus area element, critical situation and competing tension this scenario combines"),
          question: z.string().min(1),
        }),
      )
      .length(counts.L3),
  });
}

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

export function requireOpenAiKey(): void {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new Error("OPENAI_API_KEY is not configured on the server.");
  }
}

function getModel(): string {
  return process.env.OPENAI_MODEL?.trim() || "gpt-6-luna";
}

// Reasoning models think before answering; a lower effort keeps replies quick during the live interview.
function modelSettings() {
  const reasoningEffort = process.env.OPENAI_REASONING_EFFORT?.trim();
  return {
    model: openai(getModel()),
    maxOutputTokens: Number(process.env.OPENAI_MAX_OUTPUT_TOKENS) || 10000,
    providerOptions: reasoningEffort ? { openai: { reasoningEffort } } : undefined,
  };
}

function buildSystemPrompt(setting: InterviewSetting): string {
  return fillSettingFields(AGENT_SYSTEM_PROMPT, setting);
}

function fillSettingFields(template: string, setting: InterviewSetting): string {
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

  return template.split("\n")
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
    ...modelSettings(),
    system: buildSystemPrompt(setting),
    prompt: fillSettingFields(FIRST_MESSAGE_PROMPT, setting),
  });

  return result.text;
}

export async function generateChatReply(
  setting: InterviewSetting,
  history: ChatMessage[],
  userMessage: string,
): Promise<string> {
  requireOpenAiKey();

  const conversation: ChatMessage[] = [
    ...history,
    { id: "latest", role: "user", content: userMessage, createdAt: Date.now() },
  ];
  // Until a queue has been shown, a reply presenting one gets its questions from the funnel generator.
  // Once the checklist is up it runs alongside the chat reply, so the queue adds no extra wait.
  const queueDue = !history.some((message) => message.role === "assistant" && readQueueTable(message.content));
  const checklistShown = history.some((message) => message.role === "assistant" && message.content.includes("Expected Themes"));
  const earlyFunnel = queueDue && checklistShown ? settleFunnel(generateQuestionFunnel(setting, conversation)) : null;

  const tracking = sessionTracking(conversation);
  const system = tracking ? `${buildSystemPrompt(setting)}\n\n${tracking}` : buildSystemPrompt(setting);
  let reply = await generateReplyText(system, conversation);

  if (queueDue && readQueueTable(reply)) {
    const questions = await (earlyFunnel ?? settleFunnel(generateQuestionFunnel(setting, conversation)));
    return questions ? replaceQueueTable(reply, questions) : reply;
  }

  const repeats = repeatedFollowUps(reply, conversation);
  if (repeats.length) {
    console.info("Follow-ups repeated earlier questions; regenerating the reply.", repeats);
    reply = await generateReplyText(
      [
        system,
        "---",
        "**SYSTEM CHECK: REPEATED FOLLOW-UPS**",
        "A draft of this reply suggested follow-ups that repeat a starter question, a question already asked, or a follow-up already suggested:",
        ...repeats.map((repeat) => `- ${repeat}`),
        "Write the reply again with follow-ups that each take a new angle on what the SME just said (Step 3, Rule 7).",
      ].join("\n\n"),
      conversation,
    );
  }
  return reply;
}

async function generateReplyText(system: string, conversation: ChatMessage[]): Promise<string> {
  const result = await generateText({
    ...modelSettings(),
    system,
    messages: toModelMessages(conversation),
  });
  return result.text;
}

type FunnelQuestion = Pick<StarterQuestion, "text" | "actaLevel" | "focus">;

async function generateQuestionFunnel(
  setting: InterviewSetting,
  conversation: ChatMessage[] = [],
): Promise<FunnelQuestion[]> {
  const counts = getQuestionDistribution(setting.actaRatio);
  // The request goes in the system prompt: sent as an interviewer message, the model rightly treats a claim
  // to bypass the confirmation gates as an adversarial attempt.
  const result = await generateObject({
    ...modelSettings(),
    schema: questionFunnelSchema(counts),
    system: [
      buildSystemPrompt(setting),
      "---",
      "**SYSTEM REQUEST: STEP 2.1 QUESTION QUEUE**",
      "This request comes from the Tacita system, not the interviewer, so the welcome message and the confirmation gates do not apply to it.",
      `Return the Step 2.1 Initial Question Queue as structured data with exactly ${counts.L1} L1, ${counts.L2} L2 and ${counts.L3} L3 questions.`,
      "Fill the blueprint first from the setup inputs, plus the Pre-Interview Checklist and any changes the interviewer asked for if the conversation has them, then write every question from it, following the Step 2.1 rules and the Question Depth & Grounding Standard.",
    ].join("\n\n"),
    messages: [...toModelMessages(conversation), { role: "user", content: "Generate the Initial Question Queue now." }],
  });

  const { l1, l2, l3 } = result.object;
  return [
    ...l1.map(({ question }) => ({ text: question, actaLevel: "L1" as const, focus: "Task Diagram" })),
    ...l2.map(({ question, category }) => ({ text: question, actaLevel: "L2" as const, focus: `Knowledge Audit · ${category}` })),
    ...l3.map(({ question, scenarioType }) => ({ text: question, actaLevel: "L3" as const, focus: `Simulation · ${scenarioType}` })),
  ];
}

// A failed funnel call leaves the chat model's own queue in place.
function settleFunnel(funnel: Promise<FunnelQuestion[]>): Promise<FunnelQuestion[] | null> {
  return funnel.catch((error: unknown) => {
    console.warn("Question funnel generation failed; keeping the chat model's queue.", error);
    return null;
  });
}

const QUEUE_FOCUS: Record<ActaLevel, string> = { L1: "Task Diagram", L2: "Knowledge Audit", L3: "Simulation" };
const LEVEL_ICONS: Record<ActaLevel, string> = { L1: "🛠️", L2: "🧠", L3: "🏆" };

// Rows follow the Step 2.1 queue template.
function replaceQueueTable(reply: string, questions: FunnelQuestion[]): string {
  const lines = reply.split(/\r?\n/);
  const range = findQueueTable(lines);
  if (!range) {
    return reply;
  }

  const rows = questions.map(
    (question, index) =>
      `| ${index + 1} | ${QUEUE_FOCUS[question.actaLevel]} | ${toTableCell(question.text)} | ${LEVEL_ICONS[question.actaLevel]} ${question.actaLevel} | Pending |`,
  );
  const table = markdownTable(["#", "Focus", "Full Question Text", "Target", "Status"], rows);
  return [...lines.slice(0, range.start), table, ...lines.slice(range.end)].join("\n");
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
    ...modelSettings(),
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

// The queue is only shown while it is reviewed, so the most recent one is the approved queue.
function referenceQueue(history: ChatMessage[]): QueueRow[] {
  const latest = [...history].reverse().find((message) => message.role === "assistant" && readQueueTable(message.content));
  return latest ? readQueueTable(latest.content)?.rows ?? [] : [];
}

// Messages sent after the queue first appeared; review requests never contain answers, so they are harmless.
function transcriptsSinceQueue(messages: ChatMessage[]): string[] {
  const firstQueue = messages.findIndex((message) => message.role === "assistant" && readQueueTable(message.content));
  return firstQueue < 0
    ? []
    : messages.slice(firstQueue + 1).filter((message) => message.role === "user").map((message) => message.content);
}

type StarterStatus = "Answered" | "Asked, awaiting answer" | "Pending";

// Starter statuses and earlier suggestions, appended to the system prompt so the model tracks the queue without
// showing it and avoids repeating questions (Step 3, Rules 7 and 8).
function sessionTracking(conversation: ChatMessage[]): string | null {
  const rows = referenceQueue(conversation);
  if (!rows.length) {
    return null;
  }

  const transcripts = transcriptsSinceQueue(conversation);
  const suggested = suggestedFollowUps(conversation.filter((message) => message.role === "assistant"));
  return [
    "---",
    "**INTERNAL SESSION TRACKING (computed by the system from the submitted transcripts; never display it)**",
    "Starter questions in the Initial Question Queue:",
    ...rows.map((row) => `${row.cells[0]}. [${starterStatus(row.question, transcripts)}] ${row.question}`),
    "Follow-ups already suggested:",
    ...(suggested.length ? suggested.map((question) => `- ${question}`) : ["- None yet."]),
  ].join("\n");
}

// Asked alone, a question stays unanswered; the SME's reply may follow it in the same message or arrive in the next one.
export function starterStatus(question: string, transcripts: string[]): StarterStatus {
  let status: StarterStatus = "Pending";
  transcripts.forEach((transcript, index) => {
    const after = textAfterQuestion(question, transcript);
    if (after === null || status === "Answered") {
      return;
    }
    // A next message that asks something is the interviewer moving on, not the SME answering.
    const next = transcripts[index + 1];
    const answeredNext = next !== undefined && !next.includes("?") && isSubstantiveAnswer(next);
    status = isSubstantiveAnswer(after) || answeredNext ? "Answered" : "Asked, awaiting answer";
  });
  return status;
}

// The text following the densest run of the question's word pairs, or null if the question was not asked.
function textAfterQuestion(question: string, text: string): string | null {
  if (phraseOverlap(question, text) < ASKED_THRESHOLD) {
    return null;
  }

  const pairs = new Set(wordPairs(question));
  const words = [...text.matchAll(/[a-z0-9']+/gi)];
  const matched = words
    .slice(1)
    .map((word, index) => (pairs.has(`${words[index][0]} ${word[0]}`.toLowerCase()) ? index : -1))
    .filter((index) => index >= 0);

  let best: number[] = [];
  let run: number[] = [];
  for (const index of matched) {
    run = index - (run.at(-1) ?? index) > 3 ? [index] : [...run, index];
    best = run.length > best.length ? run : best;
  }
  const lastWord = words[(best.at(-1) ?? 0) + 1];
  return text.slice((lastWord.index ?? 0) + lastWord[0].length);
}

const MIN_ANSWER_WORDS = 5;

// Speaker labels and further questions do not count as an answer.
function isSubstantiveAnswer(text: string): boolean {
  const statements = text
    .replace(/^[^\S\n]*[^\n:?.!]{1,40}:/gm, " ")
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !sentence.trim().endsWith("?"));
  return (statements.join(" ").match(/[a-z0-9']+/gi)?.length ?? 0) >= MIN_ANSWER_WORDS;
}

// New follow-ups that repeat a starter question, a question already asked, an earlier suggestion, or each other.
function repeatedFollowUps(reply: string, conversation: ChatMessage[]): string[] {
  const fresh = suggestedFollowUps([{ id: "reply", role: "assistant", content: reply, createdAt: Date.now() }]);
  if (!fresh.length) {
    return [];
  }

  const askedQuestions = transcriptsSinceQueue(conversation).flatMap((transcript) =>
    transcript.split(/(?<=[.!?])\s+/).filter((sentence) => sentence.trim().endsWith("?")),
  );
  const existing = [
    ...referenceQueue(conversation).map((row) => row.question),
    ...askedQuestions,
    ...suggestedFollowUps(conversation.filter((message) => message.role === "assistant")),
  ];
  return fresh.filter(
    (candidate, index) =>
      existing.some((question) => isRepeatQuestion(candidate, question)) ||
      fresh.slice(0, index).some((question) => isRepeatQuestion(candidate, question)),
  );
}

// Near-verbatim repeats and light rewordings; deeper overlap is left to the No-Overlap Check in the prompt.
export function isRepeatQuestion(a: string, b: string): boolean {
  const aWords = contentWords(a);
  const bWords = contentWords(b);
  const shared = [...aWords].filter((word) => bWords.has(word)).length;
  return (shared >= 3 && shared / Math.min(aWords.size, bWords.size) >= 0.7) || phraseOverlap(a, b) >= ASKED_THRESHOLD;
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

  const questions = await generateQuestionFunnel(setting);
  return questions.map((question) => ({
    ...question,
    id: crypto.randomUUID(),
    status: "planned" as const,
    source: "starter" as const,
  }));
}

export async function createFollowUps(session: InterviewSession): Promise<FollowUpSuggestion[]> {
  requireOpenAiKey();

  const result = await generateObject({
    ...modelSettings(),
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
    ...modelSettings(),
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
    ...modelSettings(),
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
