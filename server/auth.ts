import type { NextFunction, Request, Response } from "express";
import type { Role } from "../shared/types";

export interface AuthSession {
  token: string;
  accountId: string;
  username: string;
  displayName: string;
  role: Role;
}

const sessions = new Map<string, AuthSession>();

export function createAuthSession(account: Omit<AuthSession, "token">): AuthSession {
  const session: AuthSession = {
    token: crypto.randomUUID(),
    ...account,
  };
  sessions.set(session.token, session);

  return session;
}

export function requireRole(...roles: Role[]) {
  return (request: Request, response: Response, next: NextFunction) => {
    const token = request.header("authorization")?.replace(/^Bearer\s+/i, "");
    const session = token ? sessions.get(token) : null;

    if (!session) {
      response.status(401).json({ error: "Login required" });
      return;
    }

    if (!roles.includes(session.role)) {
      response.status(403).json({ error: "Role is not allowed for this action" });
      return;
    }

    response.locals.auth = session;
    next();
  };
}

export function getAuth(response: Response): AuthSession {
  return response.locals.auth as AuthSession;
}
