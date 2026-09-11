import type {
  Account,
  ChatMessage,
  InterviewSetting,
  InterviewSettingInput,
  InterviewSession,
  ManagedAccountInput,
  ManagedAccountUpdateInput,
  QuestionStatus,
  Speaker,
} from "../../shared/types";
import { clearClientSession, getClientSession, type ClientSession } from "./sessionToken";

const apiBase = import.meta.env.VITE_API_BASE ?? "";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeader(),
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    if (response.status === 401) {
      clearClientSession();
      window.dispatchEvent(new Event("tacita:auth-lost"));
    }
    throw new Error(error.error ?? "Request failed");
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export const api = {
  health: () => request<{ ok: boolean; ai: boolean; stt: boolean }>("/api/health"),
  login: (input: { username: string; password: string }) =>
    request<ClientSession>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  listAccounts: () => request<Account[]>("/api/accounts"),
  createAccount: (input: ManagedAccountInput) =>
    request<Account>("/api/accounts", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateAccount: (id: string, input: ManagedAccountUpdateInput) =>
    request<Account>(`/api/accounts/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  deleteAccount: (id: string) =>
    request<void>(`/api/accounts/${id}`, {
      method: "DELETE",
    }),
  listInterviewers: () => request<Account[]>("/api/accounts/interviewers"),
  listSettings: () => request<InterviewSetting[]>("/api/settings"),
  createSetting: (input: InterviewSettingInput) =>
    request<InterviewSetting>("/api/settings", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateSetting: (id: string, input: InterviewSettingInput) =>
    request<InterviewSetting>(`/api/settings/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  deleteSetting: (id: string) =>
    request<void>(`/api/settings/${id}`, {
      method: "DELETE",
    }),
  updateSettingAccess: (id: string, interviewerAccountId: string | null) =>
    request<InterviewSetting>(`/api/settings/${id}/access`, {
      method: "PATCH",
      body: JSON.stringify({ interviewerAccountId }),
    }),
  listSessions: () => request<InterviewSession[]>("/api/sessions"),
  createSession: (settingId: string) =>
    request<InterviewSession>("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ settingId }),
    }),
  getSession: (id: string) => request<InterviewSession>(`/api/sessions/${id}`),
  generateStarterQuestions: (id: string) =>
    request<InterviewSession>(`/api/sessions/${id}/generate-starter-questions`, {
      method: "POST",
    }),
  updateQuestion: (sessionId: string, questionId: string, patch: { text?: string; status?: QuestionStatus }) =>
    request<InterviewSession>(`/api/sessions/${sessionId}/questions/${questionId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  approveQuestions: (id: string) =>
    request<InterviewSession>(`/api/sessions/${id}/approve-questions`, {
      method: "POST",
    }),
  startSession: (id: string) =>
    request<InterviewSession>(`/api/sessions/${id}/start`, {
      method: "POST",
    }),
  addTranscript: (id: string, input: { speaker: Speaker; text: string; submittedForAi?: boolean }) =>
    request<InterviewSession>(`/api/sessions/${id}/transcript`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  generateFollowUps: (id: string) =>
    request<InterviewSession>(`/api/sessions/${id}/followups`, {
      method: "POST",
    }),
  markSuggestionUsed: (sessionId: string, suggestionId: string) =>
    request<InterviewSession>(`/api/sessions/${sessionId}/suggestions/${suggestionId}/use`, {
      method: "POST",
    }),
  chat: (sessionId: string, message: string) =>
    request<InterviewSession & { chatMessages: ChatMessage[] }>(`/api/sessions/${sessionId}/chat`, {
      method: "POST",
      body: JSON.stringify({ message }),
    }),
  endSession: (id: string) =>
    request<InterviewSession>(`/api/sessions/${id}/end`, {
      method: "POST",
    }),
  refinedTranscript: (id: string) =>
    request<InterviewSession>(`/api/sessions/${id}/refined-transcript`, {
      method: "POST",
    }),
};

function getAuthHeader(): Record<string, string> {
  const session = getClientSession();
  return session ? { Authorization: `Bearer ${session.token}` } : {};
}
