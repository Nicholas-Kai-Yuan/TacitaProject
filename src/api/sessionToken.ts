import type { Role } from "../../shared/types";

export interface ClientSession {
  token: string;
  accountId: string;
  username: string;
  displayName: string;
  role: Role;
}

const key = "tacita.auth";

export function getClientSession(): ClientSession | null {
  const raw = sessionStorage.getItem(key);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as ClientSession;
  } catch {
    sessionStorage.removeItem(key);
    return null;
  }
}

export function setClientSession(session: ClientSession): void {
  sessionStorage.setItem(key, JSON.stringify(session));
}

export function clearClientSession(): void {
  sessionStorage.removeItem(key);
}
