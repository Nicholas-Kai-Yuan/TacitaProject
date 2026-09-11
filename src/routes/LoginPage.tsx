import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogIn, Mic2 } from "lucide-react";
import { useAuth } from "../auth/AuthContext";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const auth = useAuth();
  const navigate = useNavigate();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const session = await auth.login(username, password);
      navigate(session.role === "admin" ? "/admin" : "/interviewer", { replace: true });
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Login failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="login-shell">
      <form className="login-panel" onSubmit={submit}>
        <div className="login-mark">
          <Mic2 size={24} />
        </div>
        <div>
          <p className="eyebrow">TACITA</p>
          <h1>Sign In</h1>
        </div>
        <label className="field">
          <span>Username</span>
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error && <div className="alert">{error}</div>}
        <button className="primary-action" type="submit" disabled={!username || !password || isSubmitting}>
          <LogIn size={18} />
          {isSubmitting ? "Signing in..." : "Sign In"}
        </button>
      </form>
    </section>
  );
}
