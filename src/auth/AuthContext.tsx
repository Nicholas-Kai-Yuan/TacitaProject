import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api/client";
import {
  clearClientSession,
  getClientSession,
  setClientSession,
  type ClientSession,
} from "../api/sessionToken";

interface AuthContextValue {
  session: ClientSession | null;
  login: (username: string, password: string) => Promise<ClientSession>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<ClientSession | null>(() => getClientSession());

  useEffect(() => {
    const clearSession = () => setSession(null);
    window.addEventListener("tacita:auth-lost", clearSession);
    return () => window.removeEventListener("tacita:auth-lost", clearSession);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      login: async (username, password) => {
        const nextSession = await api.login({ username, password });
        setClientSession(nextSession);
        setSession(nextSession);
        return nextSession;
      },
      logout: () => {
        clearClientSession();
        setSession(null);
      },
    }),
    [session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return context;
}
