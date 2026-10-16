import { useState } from "react";
import logo from "../assets/laurus-logo.png";
import { changePassword } from "../lib/api";

// Forced first-login gate - shown instead of the dashboard whenever the
// session's account still has app_users.must_change_password set (see
// app.py's docstring). There's no "skip for now" - the server itself 403s
// every other /api/* route until this succeeds, so dismissing this screen
// without submitting just leaves the rest of the app broken.
export default function ChangePassword({ onChanged }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords don't match");
      return;
    }
    setSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl bg-[color:var(--bg-surface)] p-9 shadow-[var(--shadow)]">
        <div className="flex flex-col items-center gap-1 text-center">
          <img src={logo} alt="Laurus Labs" className="h-11 w-auto" />
          <p className="mt-2 text-sm font-semibold text-[color:var(--text-primary)]">Set a new password</p>
          <p className="text-xs text-[color:var(--text-muted)]">
            This is your first time signing in - choose a password only you know before continuing.
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-5">
          <Field label="Current password">
            <input
              type="password"
              className="w-full border-0 bg-transparent py-1.5 text-sm text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-muted)]"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoFocus
              autoComplete="current-password"
            />
          </Field>
          <Field label="New password">
            <input
              type="password"
              className="w-full border-0 bg-transparent py-1.5 text-sm text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-muted)]"
              placeholder="At least 8 characters"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <Field label="Confirm new password">
            <input
              type="password"
              className="w-full border-0 bg-transparent py-1.5 text-sm text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-muted)]"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
        </div>

        {error && <p className="mt-4 text-center text-xs font-medium text-[color:var(--late)]">{error}</p>}

        <button
          type="submit"
          disabled={submitting || !currentPassword || !newPassword || !confirmPassword}
          className="mt-8 w-full rounded-full py-3 text-sm font-bold uppercase tracking-wide text-white shadow-[var(--shadow)] transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{ background: "var(--accent)" }}
        >
          {submitting ? "Saving…" : "Save & Continue"}
        </button>
      </form>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-[color:var(--text-primary)]">{label}</span>
      <div className="flex items-center gap-2 border-b border-[color:var(--border-strong)] pb-1 focus-within:border-[color:var(--accent)]">
        {children}
      </div>
    </label>
  );
}
