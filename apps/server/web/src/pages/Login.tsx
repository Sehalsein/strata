import { useState } from "react";
import { api, errorMessage } from "../api";
import { BrandMark } from "../components/Layout";
import { ErrorText, Field } from "../components/ui";

export function LoginPage({ serverName, onLoggedIn }: { serverName?: string; onLoggedIn: (token: string) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { token } = await api.login(username.trim(), password);
      onLoggedIn(token);
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  };

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="brand brand-lg">
          <BrandMark size={34} />
          <span className="brand-name">Strata</span>
        </div>
        <h1 className="display login-title">{serverName && serverName !== "Strata" ? serverName : "Sign in"}</h1>
        <p className="muted login-sub">Admin dashboard</p>
        <div className="stack">
          <Field label="Username">
            {(id) => <input id={id} className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="off" spellCheck={false} required autoFocus />}
          </Field>
          <Field label="Password">{(id) => <input id={id} className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />}</Field>
          <ErrorText error={error} />
          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={pending || !username || !password}>
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </div>
      </form>
    </div>
  );
}
