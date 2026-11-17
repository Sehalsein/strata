import { Children, isValidElement, useState, type ReactNode } from "react";
import { AlertTriangle, Check, ChevronRight, Copy, Info, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";
import { navigate } from "./router";

/** The building blocks articles are written in, in the landing site's glass. */

/** A slug for a heading's anchor. */
export function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

/** A section of an article; it shows up in "On this page". */
export function H2({ children, id }: { children: ReactNode; id?: string }) {
  const anchor = id ?? slugify(textOf(children));
  return (
    <h2 id={anchor} data-toc className="group mt-14 mb-4 scroll-mt-28 text-2xl font-semibold tracking-tight text-white first:mt-0">
      <a href={`#${anchor}`} className="no-underline">
        {children}
        <span data-md-skip className="ml-2 text-white/25 opacity-0 transition-opacity group-hover:opacity-100">#</span>
      </a>
    </h2>
  );
}

export function H3({ children }: { children: ReactNode }) {
  return <h3 className="mt-8 mb-3 text-lg font-semibold text-white">{children}</h3>;
}

export function P({ children }: { children: ReactNode }) {
  return <p className="my-4 leading-7 text-pretty text-white/70">{children}</p>;
}

export function List({ children, ordered }: { children: ReactNode; ordered?: boolean }) {
  const Tag = ordered ? "ol" : "ul";
  return <Tag className={cn("my-4 flex flex-col gap-2 pl-5 leading-7 text-white/70 marker:text-white/35", ordered ? "list-decimal" : "list-disc")}>{children}</Tag>;
}

/** Inline code, a key or a value to type. */
export function C({ children }: { children: ReactNode }) {
  return <code className="rounded-md border border-white/10 bg-white/[0.06] px-1.5 py-0.5 font-mono text-[0.85em] text-white/90">{children}</code>;
}

/** Something on screen to look for: a button, a field, a tab. */
export function UI({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-white">{children}</strong>;
}

/** Where to go in the dashboard: Settings → Add-ons. */
export function Path({ items }: { items: string[] }) {
  return (
    <span data-md="path" className="glass-thin inline-flex flex-wrap items-center gap-1 rounded-full px-2.5 py-0.5 align-middle text-[0.85em] font-medium text-white">
      {items.map((item, i) => (
        <span key={item} className="inline-flex items-center gap-1">
          {i > 0 && <ChevronRight className="size-3 text-white/40" />}
          <span data-md-item>{item}</span>
        </span>
      ))}
    </span>
  );
}

/** A link to another article, or out. */
export function A({ href, children }: { href: string; children: ReactNode }) {
  const internal = href.startsWith("/");
  return (
    <a
      href={href}
      onClick={internal ? (e) => (e.preventDefault(), navigate(href)) : undefined}
      target={internal ? undefined : "_blank"}
      rel={internal ? undefined : "noreferrer"}
      className="font-medium text-white underline decoration-white/30 underline-offset-4 transition-colors hover:decoration-white"
    >
      {children}
    </a>
  );
}

/** A block of commands or text, with a copy button. */
export function Code({ children, label }: { children: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(children.trim()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div data-md="code" data-md-label={label} className="glass-thin group relative my-5 overflow-hidden rounded-2xl">
      {label && <p data-md-skip className="border-b border-white/10 px-4 py-2 text-[11px] font-medium tracking-wide text-white/45 uppercase">{label}</p>}
      <pre className="overflow-x-auto px-4 py-3.5 pr-12 font-mono text-[13px] leading-relaxed text-white/85">{children.trim()}</pre>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy"
        data-md-skip
        className={cn("glass-thin absolute right-2.5 flex size-8 items-center justify-center rounded-full text-white/70 transition-opacity hover:text-white sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100", label ? "top-11" : "top-2.5")}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}

const CALLOUTS = {
  note: { icon: Info, title: "Note", tint: "rgba(130,150,255,0.10)" },
  tip: { icon: Lightbulb, title: "Tip", tint: "rgba(242,181,68,0.10)" },
  warning: { icon: AlertTriangle, title: "Heads up", tint: "rgba(232,116,58,0.12)" },
};

export function Callout({ type = "note", title, children }: { type?: keyof typeof CALLOUTS; title?: string; children: ReactNode }) {
  const c = CALLOUTS[type];
  return (
    <div data-md="callout" className="glass my-6 flex gap-3.5 rounded-2xl p-4 sm:p-5" style={{ backgroundColor: c.tint }}>
      <c.icon className="mt-0.5 size-5 shrink-0 text-white/80" />
      <div className="min-w-0 text-sm leading-6 text-white/70 [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
        <p className="mb-1 text-white">
          <strong className="font-semibold">{title ?? c.title}</strong>
        </p>
        {children}
      </div>
    </div>
  );
}

/** Numbered steps, joined by a line. */
export function Steps({ children }: { children: ReactNode }) {
  const steps = Children.toArray(children).filter(isValidElement);
  return (
    <ol className="my-6 flex flex-col">
      {steps.map((step, i) => (
        <li key={i} className="relative flex gap-4 pb-7 last:pb-0">
          {i < steps.length - 1 && <span data-md-skip aria-hidden="true" className="absolute top-9 bottom-1 left-[15px] w-px bg-white/12" />}
          <span data-md-skip className="glass-thin relative flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white">{i + 1}</span>
          <div className="min-w-0 flex-1 pt-1">{step}</div>
        </li>
      ))}
    </ol>
  );
}

export function Step({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div>
      <p className="text-white">
        <strong className="font-semibold">{title}</strong>
      </p>
      {children && <div className="text-white/70 [&>p:first-child]:mt-1.5">{children}</div>}
    </div>
  );
}

/** A two-column table: a setting or option, and what it does. */
export function Table({ head, rows }: { head: [string, string] | [string, string, string]; rows: ReactNode[][] }) {
  return (
    <div className="glass my-6 overflow-x-auto rounded-2xl">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-white/10">
            {head.map((h) => (
              <th key={h} className="px-4 py-3 text-xs font-semibold tracking-wide text-white/50 uppercase">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.07]">
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className={cn("px-4 py-3 align-top leading-6", j === 0 ? "font-medium whitespace-nowrap text-white" : "text-white/65")}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
