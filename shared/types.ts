export type Role = "it_admin" | "admin" | "interviewer";

export type ManagedAccountRole = "admin" | "interviewer";

export type ActaLevel = "L1" | "L2" | "L3";

export type SessionStatus =
  | "draft"
  | "questions_generated"
  | "ready"
  | "in_progress"
  | "ended";

export type Speaker = "interviewer" | "sme" | "unknown";

export type QuestionStatus = "planned" | "asked" | "skipped";

export interface InterviewSettingInput {
  interviewerName: string;
  smeName: string;
  jobRoleTitle: string;
  domainIndustry: string;
  jobDescription: string;
  interviewObjective: string;
  keyFocusAreas: string;
  actaRatio: string;
  assignedInterviewerAccountId?: string | null;
}

export interface InterviewSetting extends InterviewSettingInput {
  id: string;
  createdAt: number;
  updatedAt: number;
}

export interface Account {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  createdAt: number;
  updatedAt: number;
}

export interface ManagedAccountInput {
  username: string;
  displayName: string;
  password: string;
  role: ManagedAccountRole;
}

export interface ManagedAccountUpdateInput {
  username: string;
  displayName: string;
  password?: string;
  role: ManagedAccountRole;
}

export interface ActaRatio {
  L1: number;
  L2: number;
  L3: number;
}

export interface StarterQuestion {
  id: string;
  text: string;
  actaLevel: ActaLevel;
  focus: string;
  status: QuestionStatus;
  source: "starter" | "follow_up";
}

export interface TranscriptSegment {
  id: string;
  speaker: Speaker;
  text: string;
  createdAt: number;
  submittedForAi: boolean;
}

export interface FollowUpSuggestion {
  id: string;
  text: string;
  actaLevel: ActaLevel;
  focus: string;
  rationale: string;
  createdAt: number;
  used: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
}

export interface InterviewSummary {
  generatedAt: number;
  taskMap: string[];
  tacitKnowledge: string[];
  scenarioFindings: string[];
  futureExploration: string[];
}

export interface RefinedTranscriptBlock {
  id: string;
  interviewerQuestion: string;
  smeResponse: string;
}

export interface DiagnosticEvent {
  id: string;
  sessionId: string;
  message: string;
  createdAt: number;
}

export interface InterviewSession {
  id: string;
  settingId: string;
  interviewerAccountId: string;
  settingSnapshot: InterviewSetting;
  status: SessionStatus;
  createdAt: number;
  updatedAt: number;
  questionsApprovedAt?: number;
  startedAt?: number;
  endedAt?: number;
  starterQuestions: StarterQuestion[];
  transcriptSegments: TranscriptSegment[];
  followUpSuggestions: FollowUpSuggestion[];
  chatMessages: ChatMessage[];
  summary?: InterviewSummary;
  refinedTranscript?: RefinedTranscriptBlock[];
}

export interface TacitaStore {
  settings: InterviewSetting[];
  sessions: InterviewSession[];
  diagnostics: DiagnosticEvent[];
}
