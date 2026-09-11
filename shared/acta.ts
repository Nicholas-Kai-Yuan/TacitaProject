import type {
  ActaLevel,
  ActaRatio,
  FollowUpSuggestion,
  InterviewSetting,
  InterviewSummary,
  RefinedTranscriptBlock,
  StarterQuestion,
  TranscriptSegment,
} from "./types";

const ACTA_LEVELS: ActaLevel[] = ["L1", "L2", "L3"];

export function parseActaRatio(value: string): ActaRatio | null {
  const matches = [...value.matchAll(/L\s*([123])\s*[:=-]?\s*(\d+(?:\.\d+)?)\s*%?/gi)];

  if (matches.length >= 3) {
    const ratio = { L1: 0, L2: 0, L3: 0 };
    for (const match of matches) {
      ratio[`L${match[1]}` as ActaLevel] = Number(match[2]);
    }
    return isValidRatio(ratio) ? ratio : null;
  }

  const numbers = value.match(/\d+(?:\.\d+)?/g)?.map(Number);
  if (numbers?.length === 3) {
    const ratio = { L1: numbers[0], L2: numbers[1], L3: numbers[2] };
    return isValidRatio(ratio) ? ratio : null;
  }

  return null;
}

export function isValidRatio(ratio: ActaRatio): boolean {
  const total = ratio.L1 + ratio.L2 + ratio.L3;
  return ACTA_LEVELS.every((level) => ratio[level] >= 0) && Math.abs(total - 100) <= 0.5;
}

export function getQuestionDistribution(ratioText: string): Record<ActaLevel, number> {
  const ratio = parseActaRatio(ratioText) ?? { L1: 20, L2: 60, L3: 20 };
  const l1 = Math.round((15 * ratio.L1) / 100);
  const l2 = Math.round((15 * ratio.L2) / 100);
  const l3 = Math.max(0, 15 - l1 - l2);

  return normalizeDistribution({ L1: l1, L2: l2, L3: l3 });
}

function normalizeDistribution(counts: Record<ActaLevel, number>): Record<ActaLevel, number> {
  let total = counts.L1 + counts.L2 + counts.L3;
  const normalized = { ...counts };

  while (total > 15) {
    const level = ACTA_LEVELS.reduce((max, current) =>
      normalized[current] > normalized[max] ? current : max,
    );
    normalized[level] -= 1;
    total -= 1;
  }

  while (total < 15) {
    normalized.L3 += 1;
    total += 1;
  }

  return normalized;
}

const templates: Record<ActaLevel, string[]> = {
  L1: [
    "Walk me through the major stages of {role}'s work in {domain}, from the first signal that work is needed through completion.",
    "Which parts of this role usually look simple to outsiders but become difficult in practice?",
    "Where in the workflow does judgement matter most, and what makes those moments demanding?",
    "What are the recurring activities that shape success for {sme} in this role?",
    "Which handoffs, dependencies, or constraints most often change how the work is done?",
  ],
  L2: [
    "What cues does {sme} notice early that tell them a situation may become complicated?",
    "What rules of thumb or job smarts help {sme} decide what to do when information is incomplete?",
    "What patterns would an experienced person recognise that a novice might miss?",
    "What anomalies, edge cases, or weak signals deserve special attention in this work?",
    "How does {sme} prioritise competing goals when there is pressure, uncertainty, or limited time?",
    "What mental model does {sme} use to judge whether the work is on track?",
    "What workarounds or adaptations has {sme} developed that are not obvious from formal procedures?",
    "What information does {sme} seek before making a critical decision, and what information can be safely ignored?",
    "When a plan starts to fail, how does {sme} decide whether to recover, escalate, or change approach?",
  ],
  L3: [
    "Describe a recent difficult scenario in this work and what made it cognitively challenging.",
    "In that scenario, what decision points mattered most and what options were considered?",
    "What critical cues shaped the assessment of the situation as it unfolded?",
    "What trade-offs did {sme} make, and what would a novice likely misunderstand?",
    "Looking back, what should be explored further in a follow-up interview or observation session?",
  ],
};

export function generateFallbackStarterQuestions(setting: InterviewSetting): StarterQuestion[] {
  const distribution = getQuestionDistribution(setting.actaRatio);
  const questions: StarterQuestion[] = [];

  for (const level of ACTA_LEVELS) {
    for (let index = 0; index < distribution[level]; index += 1) {
      const template = templates[level][index % templates[level].length];
      questions.push({
        id: crypto.randomUUID(),
        text: hydrateTemplate(template, setting),
        actaLevel: level,
        focus: getFocus(level),
        status: "planned",
        source: "starter",
      });
    }
  }

  return questions.slice(0, 15);
}

export function generateFallbackFollowUps(
  setting: InterviewSetting,
  transcriptSegments: TranscriptSegment[],
): FollowUpSuggestion[] {
  const latest = transcriptSegments.at(-1)?.text ?? setting.interviewObjective;
  const fragment = compactText(latest, 120);
  const now = Date.now();

  return [
    {
      id: crypto.randomUUID(),
      text: `What cues in "${fragment}" helped you decide what mattered most?`,
      actaLevel: "L2",
      focus: "Critical cues",
      rationale: "Targets tacit perceptual judgement behind the SME response.",
      createdAt: now,
      used: false,
    },
    {
      id: crypto.randomUUID(),
      text: "Can you describe a specific incident where this became difficult or ambiguous?",
      actaLevel: "L3",
      focus: "Scenario probe",
      rationale: "Turns the answer into an ACTA simulation-style scenario.",
      createdAt: now + 1,
      used: false,
    },
    {
      id: crypto.randomUUID(),
      text: "What would a newer person likely overlook in that same situation?",
      actaLevel: "L2",
      focus: "Novice contrast",
      rationale: "Surfaces expert-novice differences and hidden assumptions.",
      createdAt: now + 2,
      used: false,
    },
  ];
}

export function generateFallbackSummary(
  setting: InterviewSetting,
  transcriptSegments: TranscriptSegment[],
): InterviewSummary {
  const smeSegments = transcriptSegments
    .filter((segment) => segment.speaker !== "interviewer")
    .map((segment) => segment.text);
  const transcriptText = smeSegments.join(" ");
  const evidence = compactText(transcriptText || setting.interviewObjective, 220);

  return {
    generatedAt: Date.now(),
    taskMap: [
      `${setting.smeName}'s work as ${setting.jobRoleTitle} centers on ${setting.keyFocusAreas}.`,
      `Primary domain context: ${setting.domainIndustry}.`,
      `Evidence captured: ${evidence}`,
    ],
    tacitKnowledge: [
      "Review transcript segments for cues, rules of thumb, mental models, workarounds, and expert-novice contrasts.",
      "Use follow-up suggestions marked during the session as the first pass at tacit-knowledge evidence.",
    ],
    scenarioFindings: [
      "Identify concrete incidents where decisions, assessments, trade-offs, or adaptations occurred.",
      "Capture what changed during the situation and how the SME knew to change approach.",
    ],
    futureExploration: [
      "Probe unresolved reasoning paths in a follow-up interview.",
      "Observe the SME in-context if transcript evidence does not fully explain cues or decision timing.",
    ],
  };
}

export function generateFallbackRefinedTranscript(
  segments: TranscriptSegment[],
): RefinedTranscriptBlock[] {
  const blocks: RefinedTranscriptBlock[] = [];
  let pendingQuestion = "";

  for (const segment of segments) {
    if (segment.speaker === "interviewer") {
      pendingQuestion = segment.text;
      continue;
    }

    if (segment.speaker === "sme") {
      blocks.push({
        id: crypto.randomUUID(),
        interviewerQuestion: pendingQuestion || "Interviewer prompt not captured",
        smeResponse: segment.text,
      });
      pendingQuestion = "";
    }
  }

  return blocks;
}

export function compactText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trim()}...`;
}

function hydrateTemplate(template: string, setting: InterviewSetting): string {
  return template
    .replaceAll("{role}", setting.jobRoleTitle)
    .replaceAll("{domain}", setting.domainIndustry)
    .replaceAll("{sme}", setting.smeName);
}

function getFocus(level: ActaLevel): string {
  if (level === "L1") {
    return "Task map / cognitive hotspots";
  }

  if (level === "L2") {
    return "Knowledge audit / expertise";
  }

  return "Simulation interview / decision points";
}
