import type { ReactNode } from "react";
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ClipboardList, LogOut, Mic2, ShieldCheck, UsersRound } from "lucide-react";
import type { Role } from "../shared/types";
import { useAuth } from "./auth/AuthContext";
import AdminSettingsPage from "./routes/AdminSettingsPage";
import InterviewerPage from "./routes/InterviewerPage";
import InterviewSessionPage from "./routes/InterviewSessionPage";
import ItAdminAccountsPage from "./routes/ItAdminAccountsPage";
import LoginPage from "./routes/LoginPage";

export default function App() {
  const { session, logout } = useAuth();
  const navigate = useNavigate();

  function signOut() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="app-shell">
      {session && (
        <header className="topbar">
        <NavLink to={homeForRole(session.role)} className="brand" aria-label="TACITA home">
          <span className="brand-mark">
            <Mic2 size={18} />
          </span>
          <span>
            <strong>TACITA</strong>
            <small>AI Interview Support</small>
          </span>
        </NavLink>
        <nav className="role-nav" aria-label="Primary navigation">
          {session.role === "it_admin" && (
            <NavLink to="/it-admin" className={({ isActive }) => (isActive ? "nav-pill active" : "nav-pill")}>
              <UsersRound size={18} />
              IT Admin
            </NavLink>
          )}
          {session.role === "admin" && (
            <NavLink to="/admin" className={({ isActive }) => (isActive ? "nav-pill active" : "nav-pill")}>
              <ShieldCheck size={18} />
              Admin
            </NavLink>
          )}
          {session.role === "interviewer" && (
            <NavLink to="/interviewer" className={({ isActive }) => (isActive ? "nav-pill active" : "nav-pill")}>
              <ClipboardList size={18} />
              Interviewer
            </NavLink>
          )}
          <button className="nav-pill nav-button" type="button" onClick={signOut}>
            <LogOut size={18} />
            Sign Out
          </button>
        </nav>
        </header>
      )}

      <main>
        <Routes>
          <Route path="/login" element={session ? <Navigate to={homeForRole(session.role)} replace /> : <LoginPage />} />
          <Route path="/" element={<Navigate to={session ? homeForRole(session.role) : "/login"} replace />} />
          <Route
            path="/it-admin"
            element={
              <RequireRole role="it_admin">
                <ItAdminAccountsPage />
              </RequireRole>
            }
          />
          <Route
            path="/admin"
            element={
              <RequireRole role="admin">
                <AdminSettingsPage />
              </RequireRole>
            }
          />
          <Route
            path="/interviewer"
            element={
              <RequireRole role="interviewer">
                <InterviewerPage />
              </RequireRole>
            }
          />
          <Route
            path="/interviewer/sessions/:sessionId"
            element={
              <RequireRole role="interviewer">
                <InterviewSessionPage />
              </RequireRole>
            }
          />
        </Routes>
      </main>
    </div>
  );
}

function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { session } = useAuth();
  const location = useLocation();

  if (!session) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  if (session.role !== role) {
    return <Navigate to={homeForRole(session.role)} replace />;
  }

  return children;
}

function homeForRole(role: Role): string {
  if (role === "it_admin") {
    return "/it-admin";
  }

  return role === "admin" ? "/admin" : "/interviewer";
}
