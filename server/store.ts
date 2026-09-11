import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type {
  Account,
  DiagnosticEvent,
  FollowUpSuggestion,
  InterviewSetting,
  InterviewSettingInput,
  InterviewSession,
  InterviewSummary,
  ManagedAccountInput,
  ManagedAccountUpdateInput,
  RefinedTranscriptBlock,
  Role,
  StarterQuestion,
  TranscriptSegment,
} from "../shared/types";

const convexUrl = process.env.VITE_CONVEX_URL;

if (!convexUrl) {
  throw new Error("VITE_CONVEX_URL is required. Add your Convex Cloud URL to .env.");
}

const convex = new ConvexHttpClient(convexUrl);
let bootstrapPromise: Promise<void> | null = null;

type ConvexSettingDoc = Awaited<ReturnType<typeof listSettingsRaw>>[number];
type ConvexSessionDoc = NonNullable<Awaited<ReturnType<typeof getSessionRaw>>>;
type ConvexAccountDoc = Awaited<ReturnType<typeof listManagedAccountsRaw>>[number];
type ConvexLoginAccountDoc = NonNullable<Awaited<ReturnType<typeof getAccountByUsernameRaw>>>;

export async function ensureBootstrapAccounts(): Promise<void> {
  bootstrapPromise ??= bootstrapAccounts();
  await bootstrapPromise;
}

export async function authenticateAccount(username: string, password: string): Promise<Account | null> {
  await ensureBootstrapAccounts();

  const account = await getAccountByUsernameRaw(normalizeUsername(username));
  if (!account || !verifyPassword(password, account.passwordSalt, account.passwordHash)) {
    return null;
  }

  return mapAccount(account);
}

export async function listManagedAccounts(): Promise<Account[]> {
  const accounts = await listManagedAccountsRaw();
  return accounts.map(mapAccount);
}

export async function listInterviewers(): Promise<Account[]> {
  const accounts = await convex.query(api.accounts.listInterviewers, {});
  return accounts.map(mapAccount);
}

export async function createManagedAccount(input: ManagedAccountInput): Promise<Account> {
  const password = hashPassword(input.password);
  const id = await convex.mutation(api.accounts.create, {
    username: normalizeUsername(input.username),
    displayName: input.displayName.trim(),
    role: input.role,
    passwordHash: password.hash,
    passwordSalt: password.salt,
  });

  const account = await convex.query(api.accounts.get, { id: id as never });
  if (!account) {
    throw new Error("Created account could not be loaded from Convex");
  }

  return mapAccount(account);
}

export async function updateManagedAccount(
  id: string,
  input: ManagedAccountUpdateInput,
): Promise<Account | null> {
  const passwordPatch = input.password?.trim() ? hashPassword(input.password) : null;

  await convex.mutation(api.accounts.update, {
    id: id as never,
    username: normalizeUsername(input.username),
    displayName: input.displayName.trim(),
    role: input.role,
    passwordHash: passwordPatch?.hash,
    passwordSalt: passwordPatch?.salt,
  });

  if (input.role !== "interviewer") {
    await unassignInterviewSettingsForAccount(id);
  }

  const account = await convex.query(api.accounts.get, { id: id as never });
  return account ? mapAccount(account) : null;
}

export async function deleteManagedAccount(id: string): Promise<boolean> {
  await unassignInterviewSettingsForAccount(id);
  await convex.mutation(api.accounts.remove, { id: id as never });
  return true;
}

export async function listSettings(auth: { role: Role; accountId: string }): Promise<InterviewSetting[]> {
  const settings = (await listSettingsRaw()).map(mapSetting);
  if (auth.role === "interviewer") {
    return settings.filter((setting) => setting.assignedInterviewerAccountId === auth.accountId);
  }

  return settings;
}

export async function createSetting(input: InterviewSettingInput): Promise<InterviewSetting> {
  const id = await convex.mutation(api.interviewSettings.create, sanitizeSettingInput(input));
  const settings = await listSettingsRaw();
  const setting = settings.find((item) => String(item._id) === String(id));
  if (!setting) {
    throw new Error("Created interview setting could not be loaded from Convex");
  }

  return mapSetting(setting);
}

export async function updateSetting(
  id: string,
  input: InterviewSettingInput,
): Promise<InterviewSetting | null> {
  await convex.mutation(api.interviewSettings.update, {
    id: id as never,
    ...sanitizeSettingInput(input),
  });

  const settings = await listSettingsRaw();
  return mapSettingOrNull(settings.find((item) => String(item._id) === id));
}

export async function updateSettingAccess(
  id: string,
  interviewerAccountId: string | null,
): Promise<InterviewSetting | null> {
  await convex.mutation(api.interviewSettings.updateAccess, {
    id: id as never,
    interviewerAccountId: interviewerAccountId as never,
  });

  const settings = await listSettingsRaw();
  return mapSettingOrNull(settings.find((item) => String(item._id) === id));
}

export async function deleteSetting(id: string): Promise<boolean> {
  await convex.mutation(api.interviewSettings.remove, { id: id as never });
  return true;
}

export async function listSessions(interviewerAccountId: string): Promise<InterviewSession[]> {
  const sessions = await convex.query(api.interviewSessions.list, {});
  return sessions
    .map(mapSession)
    .filter((session) => session.interviewerAccountId === interviewerAccountId);
}

export async function getSession(
  id: string,
  interviewerAccountId?: string,
): Promise<InterviewSession | null> {
  const session = await getSessionRaw(id);
  if (!session) {
    return null;
  }

  const mapped = mapSession(session);
  if (interviewerAccountId && mapped.interviewerAccountId !== interviewerAccountId) {
    return null;
  }

  return mapped;
}

export async function createSession(
  settingId: string,
  interviewerAccountId: string,
): Promise<InterviewSession | null> {
  try {
    const id = await convex.mutation(api.interviewSessions.create, {
      settingId: settingId as never,
      interviewerAccountId: interviewerAccountId as never,
    });
    return getSession(String(id), interviewerAccountId);
  } catch (error) {
    if (getErrorMessage(error).includes("does not have access")) {
      return null;
    }

    throw error;
  }
}

export async function setStarterQuestions(
  sessionId: string,
  questions: StarterQuestion[],
  interviewerAccountId?: string,
): Promise<InterviewSession | null> {
  await ensureSessionAccess(sessionId, interviewerAccountId);
  await convex.mutation(api.interviewSessions.replaceStarterQuestions, {
    id: sessionId as never,
    questions,
  });
  return getSession(sessionId, interviewerAccountId);
}

export async function updateQuestion(
  sessionId: string,
  questionId: string,
  patch: Partial<Pick<StarterQuestion, "text" | "status">>,
  interviewerAccountId?: string,
): Promise<InterviewSession | null> {
  await ensureSessionAccess(sessionId, interviewerAccountId);
  await convex.mutation(api.interviewSessions.updateQuestion, {
    id: sessionId as never,
    questionId,
    text: patch.text,
    status: patch.status,
  });
  return getSession(sessionId, interviewerAccountId);
}

export async function approveQuestions(
  sessionId: string,
  interviewerAccountId?: string,
): Promise<InterviewSession | null> {
  await ensureSessionAccess(sessionId, interviewerAccountId);
  await convex.mutation(api.interviewSessions.approveQuestions, { id: sessionId as never });
  return getSession(sessionId, interviewerAccountId);
}

export async function startSession(
  sessionId: string,
  interviewerAccountId?: string,
): Promise<InterviewSession | null> {
  await ensureSessionAccess(sessionId, interviewerAccountId);
  await convex.mutation(api.interviewSessions.start, { id: sessionId as never });
  return getSession(sessionId, interviewerAccountId);
}

export async function addTranscriptSegment(
  sessionId: string,
  segment: Omit<TranscriptSegment, "id" | "createdAt">,
  interviewerAccountId?: string,
): Promise<InterviewSession | null> {
  await ensureSessionAccess(sessionId, interviewerAccountId);
  await convex.mutation(api.interviewSessions.addTranscriptSegment, {
    id: sessionId as never,
    speaker: segment.speaker,
    text: segment.text,
    submittedForAi: segment.submittedForAi,
  });
  return getSession(sessionId, interviewerAccountId);
}

export async function addFollowUps(
  sessionId: string,
  suggestions: FollowUpSuggestion[],
  interviewerAccountId?: string,
): Promise<InterviewSession | null> {
  await ensureSessionAccess(sessionId, interviewerAccountId);
  await convex.mutation(api.interviewSessions.addFollowUps, {
    id: sessionId as never,
    suggestions,
  });
  return getSession(sessionId, interviewerAccountId);
}

export async function markSuggestionUsed(
  sessionId: string,
  suggestionId: string,
  interviewerAccountId?: string,
): Promise<InterviewSession | null> {
  await ensureSessionAccess(sessionId, interviewerAccountId);
  await convex.mutation(api.interviewSessions.markSuggestionUsed, {
    id: sessionId as never,
    suggestionId,
  });
  return getSession(sessionId, interviewerAccountId);
}

export async function addChatExchange(
  sessionId: string,
  userMessage: string,
  assistantMessage: string,
  interviewerAccountId?: string,
): Promise<InterviewSession | null> {
  await ensureSessionAccess(sessionId, interviewerAccountId);
  await convex.mutation(api.interviewSessions.addChatExchange, {
    id: sessionId as never,
    userMessage,
    assistantMessage,
  });
  return getSession(sessionId, interviewerAccountId);
}

export async function endSession(
  sessionId: string,
  summary: InterviewSummary,
  interviewerAccountId?: string,
): Promise<InterviewSession | null> {
  await ensureSessionAccess(sessionId, interviewerAccountId);
  await convex.mutation(api.interviewSessions.end, {
    id: sessionId as never,
    summary,
  });
  return getSession(sessionId, interviewerAccountId);
}

export async function setRefinedTranscript(
  sessionId: string,
  refinedTranscript: RefinedTranscriptBlock[],
  interviewerAccountId?: string,
): Promise<InterviewSession | null> {
  await ensureSessionAccess(sessionId, interviewerAccountId);
  await convex.mutation(api.interviewSessions.setRefinedTranscript, {
    id: sessionId as never,
    refinedTranscript,
  });
  return getSession(sessionId, interviewerAccountId);
}

export async function addDiagnostic(
  sessionId: string,
  message: string,
): Promise<DiagnosticEvent> {
  const id = await convex.mutation(api.interviewSessions.addDiagnostic, {
    sessionId,
    message,
  });
  return {
    id: String(id),
    sessionId,
    message,
    createdAt: Date.now(),
  };
}

async function bootstrapAccounts() {
  const defaults = [
    {
      username: process.env.IT_ADMIN_USERNAME ?? "itadmin",
      password: process.env.IT_ADMIN_PASSWORD ?? "itadmin123",
      displayName: "IT Admin",
      role: "it_admin" as const,
    },
    {
      username: process.env.ADMIN_USERNAME ?? "admin",
      password: process.env.ADMIN_PASSWORD ?? "admin123",
      displayName: "Admin",
      role: "admin" as const,
    },
    {
      username: process.env.INTERVIEWER_USERNAME ?? "interviewer",
      password: process.env.INTERVIEWER_PASSWORD ?? "interviewer123",
      displayName: "Interviewer",
      role: "interviewer" as const,
    },
  ];

  for (const account of defaults) {
    const password = hashPassword(account.password);
    await convex.mutation(api.accounts.bootstrap, {
      username: normalizeUsername(account.username),
      displayName: account.displayName,
      role: account.role,
      passwordHash: password.hash,
      passwordSalt: password.salt,
    });
  }
}

async function listManagedAccountsRaw() {
  return await convex.query(api.accounts.listManaged, {});
}

async function getAccountByUsernameRaw(username: string) {
  return await convex.query(api.accounts.getByUsername, { username });
}

async function listSettingsRaw() {
  return await convex.query(api.interviewSettings.list, {});
}

async function getSessionRaw(id: string) {
  return await convex.query(api.interviewSessions.get, { id: id as never });
}

async function ensureSessionAccess(sessionId: string, interviewerAccountId?: string): Promise<void> {
  if (!interviewerAccountId) {
    return;
  }

  const session = await getSessionRaw(sessionId);
  if (!session || String(session.interviewerAccountId ?? "") !== interviewerAccountId) {
    throw new Error("Interview session not found");
  }
}

async function unassignInterviewSettingsForAccount(accountId: string): Promise<void> {
  const settings = await listSettingsRaw();
  await Promise.all(
    settings
      .filter((setting) => String(setting.assignedInterviewerAccountId ?? "") === accountId)
      .map((setting) =>
        convex.mutation(api.interviewSettings.updateAccess, {
          id: setting._id,
          interviewerAccountId: null,
        }),
      ),
  );
}

function sanitizeSettingInput(input: InterviewSettingInput) {
  return {
    interviewerName: input.interviewerName.trim(),
    smeName: input.smeName.trim(),
    jobRoleTitle: input.jobRoleTitle.trim(),
    domainIndustry: input.domainIndustry.trim(),
    jobDescription: input.jobDescription.trim(),
    interviewObjective: input.interviewObjective.trim(),
    keyFocusAreas: input.keyFocusAreas.trim(),
    actaRatio: input.actaRatio.trim(),
    assignedInterviewerAccountId: input.assignedInterviewerAccountId
      ? (input.assignedInterviewerAccountId as never)
      : null,
  };
}

function mapAccount(account: ConvexAccountDoc | ConvexLoginAccountDoc): Account {
  return {
    id: String(account._id),
    username: account.username,
    displayName: account.displayName,
    role: account.role,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

function mapSetting(setting: ConvexSettingDoc): InterviewSetting {
  return {
    id: String(setting._id),
    interviewerName: setting.interviewerName,
    smeName: setting.smeName,
    jobRoleTitle: setting.jobRoleTitle,
    domainIndustry: setting.domainIndustry,
    jobDescription: setting.jobDescription,
    interviewObjective: setting.interviewObjective,
    keyFocusAreas: setting.keyFocusAreas,
    actaRatio: setting.actaRatio,
    assignedInterviewerAccountId: setting.assignedInterviewerAccountId
      ? String(setting.assignedInterviewerAccountId)
      : null,
    createdAt: setting.createdAt,
    updatedAt: setting.updatedAt,
  };
}

function mapSettingOrNull(setting: ConvexSettingDoc | undefined): InterviewSetting | null {
  return setting ? mapSetting(setting) : null;
}

function mapSession(session: ConvexSessionDoc): InterviewSession {
  const snapshot = session.settingSnapshot;

  return {
    id: String(session._id),
    settingId: String(session.settingId),
    interviewerAccountId: session.interviewerAccountId ? String(session.interviewerAccountId) : "",
    settingSnapshot: {
      id: String(session.settingId),
      interviewerName: snapshot.interviewerName,
      smeName: snapshot.smeName,
      jobRoleTitle: snapshot.jobRoleTitle,
      domainIndustry: snapshot.domainIndustry,
      jobDescription: snapshot.jobDescription,
      interviewObjective: snapshot.interviewObjective,
      keyFocusAreas: snapshot.keyFocusAreas,
      actaRatio: snapshot.actaRatio,
      assignedInterviewerAccountId: snapshot.assignedInterviewerAccountId
        ? String(snapshot.assignedInterviewerAccountId)
        : null,
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
    },
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    questionsApprovedAt: session.questionsApprovedAt,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    starterQuestions: session.starterQuestions,
    transcriptSegments: session.transcriptSegments,
    followUpSuggestions: session.followUpSuggestions,
    chatMessages: session.chatMessages,
    summary: session.summary,
    refinedTranscript: session.refinedTranscript,
  };
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return { hash, salt };
}

function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const actual = Buffer.from(scryptSync(password, salt, 64).toString("hex"), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
