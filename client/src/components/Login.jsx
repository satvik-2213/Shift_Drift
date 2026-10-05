import { useState } from "react";
import logo from "../assets/laurus-logo.png";
import { login } from "../lib/api";
import LoginIllustration from "./LoginIllustration";

export default function Login({ onLoggedIn }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(username, password);
      onLoggedIn();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen">
      <div className="w-full lg:w-1/2">
        <LoginIllustration />
      </div>

      <div className="flex w-full items-center justify-center px-4 lg:w-1/2">
        <form onSubmit={submit} className="w-full max-w-sm rounded-2xl bg-[color:var(--bg-surface)] p-9 shadow-[var(--shadow)]">
          <div className="flex flex-col items-center gap-1 text-center">
            <img src={logo} alt="Laurus Labs" className="h-11 w-auto" />
            <p className="mt-2 text-sm font-semibold text-[color:var(--text-primary)]">Shift Drift Dashboard</p>
          </div>

          <div className="mt-8 flex flex-col gap-5">
            <UnderlineField label="User Name" icon={<UserIcon />}>
              <input
                className="w-full border-0 bg-transparent py-1.5 text-sm text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-muted)]"
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                autoComplete="username"
              />
            </UnderlineField>
            <UnderlineField label="Password" icon={<LockIcon />}>
              <input
                type="password"
                className="w-full border-0 bg-transparent py-1.5 text-sm text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-muted)]"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </UnderlineField>
          </div>

          {error && <p className="mt-4 text-center text-xs font-medium text-[color:var(--late)]">{error}</p>}

          <button
            type="submit"
            disabled={submitting || !username || !password}
            className="mt-8 w-full rounded-full py-3 text-sm font-bold uppercase tracking-wide text-white shadow-[var(--shadow)] transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: "var(--accent)" }}
          >
            {submitting ? "Signing in…" : "Login"}
          </button>
        </form>
      </div>
    </div>
  );
}

function UnderlineField({ label, icon, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-[color:var(--text-primary)]">{label}</span>
      <div className="flex items-center gap-2 border-b border-[color:var(--border-strong)] pb-1 focus-within:border-[color:var(--accent)]">
        <span className="h-4 w-4 flex-none text-[color:var(--text-muted)]">{icon}</span>
        {children}
      </div>
    </label>
  );
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
