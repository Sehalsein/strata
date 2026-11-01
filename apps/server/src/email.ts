import { logger } from "./log";

const log = logger("email");

/**
 * Email, by Resend (https://resend.com), only when the server has RESEND_API_KEY and
 * STRATA_EMAIL_FROM (e.g. `Strata <no-reply@example.com>`, on a domain verified in
 * Resend). Without them Strata sends no mail and nothing that needs it shows.
 */
export function emailConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY && process.env.STRATA_EMAIL_FROM);
}

/** Addresses Strata made up for accounts without an email: nothing can be sent to them. */
export const isPlaceholderEmail = (email: string) => email.toLowerCase().endsWith("@users.strata");

export async function sendEmail(message: { to: string; subject: string; text: string; html: string }): Promise<void> {
  if (!emailConfigured() || isPlaceholderEmail(message.to)) return;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.STRATA_EMAIL_FROM, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    log.error(`Resend refused the email (${res.status}): ${(await res.text()).slice(0, 300)}`);
    throw new Error("Couldn't send the email");
  }
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A plain, single-button email in both HTML and text. */
export function simpleEmail({ greeting, lines, button, footer }: { greeting: string; lines: string[]; button: { label: string; url: string }; footer: string }) {
  const text = [greeting, "", ...lines, "", `${button.label}: ${button.url}`, "", footer].join("\n");
  const html = `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;line-height:1.5;max-width:520px;margin:0 auto;padding:24px">
<p>${escape(greeting)}</p>${lines.map((l) => `<p>${escape(l)}</p>`).join("")}
<p style="margin:28px 0"><a href="${escape(button.url)}" style="background:#ef8a4c;color:#111;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${escape(button.label)}</a></p>
<p style="color:#666;font-size:13px">${escape(footer)}</p></body></html>`;
  return { text, html };
}
