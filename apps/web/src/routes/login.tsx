import { useState } from "react";
import { Navigate, useNavigate } from "@tanstack/react-router";
import { motion } from "motion/react";
import { signIn, useSession } from "@/lib/auth-client";
import { toast, errorMessage } from "@/lib/toast";

export const LoginPage = () => {
  const navigate = useNavigate();
  const { data: session, isPending } = useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (isPending) return null;
  if (session) return <Navigate to="/" />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(username, password);
      toast.success("Welcome back");
      navigate({ to: "/" });
    } catch (err) {
      console.error("[login] sign-in failed", err);
      const message = errorMessage(err);
      setError(message);
      toast.error("Sign in failed", { description: message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="strata relative flex min-h-screen overflow-hidden bg-strata-bg text-strata-text">
      {/* Ambient warm bloom */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(50% 60% at 80% 18%, rgb(232 179 65 / 0.18), transparent), radial-gradient(45% 55% at 12% 88%, rgb(232 51 31 / 0.14), transparent)",
        }}
      />
      <div className="grain-paper pointer-events-none absolute inset-0 opacity-50 mix-blend-overlay" />

      {/* Left column: cover */}
      <aside className="relative hidden flex-1 flex-col justify-between border-r rule-thin p-12 lg:flex">
        <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.32em] text-strata-text/45">
          <span className="anim-pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-strata-accent" />
          <span>The Strata Cinemathèque</span>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          className="flex flex-col gap-8"
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-strata-text/45">
            Vol. III · № 047 · MMXXVI
          </div>
          <h1
            className="font-display text-strata-paper"
            style={{
              fontSize: "clamp(96px, 12vw, 180px)",
              lineHeight: "0.86",
              fontVariationSettings: '"opsz" 144, "SOFT" 40, "WONK" 1',
              letterSpacing: "-0.05em",
              marginTop: "-0.06em",
              marginBottom: "-0.06em",
            }}
          >
            Strata
          </h1>
          <p
            className="max-w-md font-editorial text-[22px] leading-[1.35] text-strata-text/70"
          >
            A private, hand-curated cinemathèque for the projection of motion pictures and episodic programmes — local files, no algorithm, no compromise.
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-3 pt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-strata-text/45">
            <span>· 4K · HDR · Atmos</span>
            <span>· Subtitles in 47 languages</span>
            <span>· Mood-tagged & cross-referenced</span>
          </div>
        </motion.div>

        <div className="flex items-end justify-between gap-6 border-t rule-thin pt-6 font-mono text-[10px] uppercase tracking-[0.22em] text-strata-text/45">
          <span>“In the dark, with light, everything possible.”</span>
          <span>— a colophon</span>
        </div>
      </aside>

      {/* Right column: form */}
      <section className="relative z-10 flex w-full flex-col justify-center p-8 lg:w-[520px] lg:p-14">
        <div className="lg:hidden mb-10 flex items-baseline gap-3">
          <span
            className="font-display text-[56px] leading-none text-strata-paper"
            style={{
              fontVariationSettings: '"opsz" 144, "SOFT" 40, "WONK" 1',
              letterSpacing: "-0.045em",
            }}
          >
            Strata
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-strata-text/45">
            Cinemathèque
          </span>
        </div>

        <motion.form
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut", delay: 0.1 }}
          onSubmit={submit}
          className="flex flex-col gap-6"
        >
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-strata-accent">
              Re-Admission
            </span>
            <h2
              className="font-display text-strata-paper"
              style={{
                fontSize: "clamp(40px, 4.5vw, 64px)",
                lineHeight: "0.95",
                fontVariationSettings: '"opsz" 96, "SOFT" 30, "WONK" 1',
                letterSpacing: "-0.04em",
              }}
            >
              Welcome
              <br />
              <em className="font-editorial italic">back.</em>
            </h2>
            <p className="mt-2 font-editorial text-[16px] text-strata-text/55">
              Step inside. The doors are still warm.
            </p>
          </div>

          <div className="mt-2 h-px w-full bg-strata-text/15" />

          <Field
            label="Username"
            value={username}
            onChange={setUsername}
            required
            autoComplete="username"
            num="01"
          />
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            required
            autoComplete="current-password"
            num="02"
          />

          {error && (
            <div className="border border-strata-danger/40 bg-strata-danger/10 px-3 py-2.5 font-mono text-[11px] uppercase tracking-[0.18em] text-strata-danger">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="btn-play mt-1 w-full justify-center"
          >
            {busy ? <span className="anim-blink">···</span> : "Enter"}
          </button>

          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-strata-text/40">
            New here? Set up your account in the Jellyfin admin panel first.
          </p>
        </motion.form>
      </section>
    </div>
  );
};

const Field = ({
  label,
  value,
  onChange,
  type = "text",
  required,
  autoComplete,
  minLength,
  num,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  minLength?: number;
  num: string;
}) => (
  <label className="group flex flex-col gap-2">
    <span className="flex items-baseline gap-3 font-mono text-[10px] uppercase tracking-[0.22em] text-strata-text/45 group-focus-within:text-strata-paper">
      <span className="text-strata-text/30">№ {num}</span>
      <span>·</span>
      <span>{label}</span>
    </span>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required={required}
      autoComplete={autoComplete}
      minLength={minLength}
      className="border-b border-strata-text/20 bg-transparent py-2 font-display text-[22px] text-strata-paper outline-none transition-colors focus:border-strata-accent"
      style={{
        fontVariationSettings: '"opsz" 36, "SOFT" 50',
        letterSpacing: "-0.02em",
      }}
    />
  </label>
);
