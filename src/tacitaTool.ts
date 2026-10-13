import type { InterviewSetting } from "../shared/types";

// Tool setup from the Tacita Tools Documentation; the wording is kept as documented.
export const TOOL_NAME = "Tacita: The ACTA Whisperer (v3.9)";

export const TOOL_DESCRIPTION =
  "A silent AI co-pilot providing real-time interview support and dynamic follow-up questions to capture deep, expert-level knowledge";

export const BEGIN_BUTTON_TEXT = "Begin Now";

export const USER_INSTRUCTIONS = {
  title: "Real-Time Interview Support & Tracking",
  intro:
    "Please complete the interview profile below before meeting with your interviewee. The information you provide will be used to generate your initial interview questions. During the interview, simply send the transcript to Tacita to generate follow-up questions that help you probe deeper and uncover expert knowledge.",
  levelsTitle: "Tacita supports three levels of knowledge elicitation:",
  levels: [
    {
      label: "L1 – Road Map:",
      text: "Identify the major steps in the work and where thinking or decision-making is most challenging.",
    },
    {
      label: "L2 – Expertise:",
      text: "Uncover the cues, strategies, mental models, and decision-making processes that experienced practitioners use but may not explicitly describe.",
    },
    {
      label: "L3 – Simulation:",
      text: 'Test judgment through realistic scenarios and "what-if" situations to reveal how experts assess changing conditions, make decisions, and adapt their actions.',
    },
  ],
};

export function chatThreadTitle(setting: Pick<InterviewSetting, "interviewerName" | "smeName">): string {
  return `Interview between ${setting.interviewerName} and ${setting.smeName}`;
}
