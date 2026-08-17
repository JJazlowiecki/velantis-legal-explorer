import "server-only";

import { getServerEnv } from "@/lib/env/server";

export interface SendMailInput {
	to: string;
	subject: string;
	html: string;
	text: string;
}

export type SendMailResult = { ok: true } | { ok: false; reason: "not_configured" | "provider_error" };

/**
 * Minimal HTTP-API transactional mail adapter — Resend-compatible request shape
 * (`https://api.resend.com/emails`, `Authorization: Bearer <key>`, JSON body with
 * `from`/`to`/`subject`/`html`/`text`). Deliberately the ONLY place that knows about a mail
 * provider — Better Auth's `sendResetPassword`/`sendVerificationEmail` callbacks (see
 * src/lib/auth/auth.ts) call this and nothing else.
 *
 * Never throws and never fakes success: missing `MAIL_API_KEY`/`MAIL_FROM` returns
 * `{ ok: false, reason: "not_configured" }` without attempting a network call — the caller
 * (Better Auth) already responds to the end user in an anti-enumeration-safe, generic way
 * regardless of whether an email actually went out, so a real send failure here is logged
 * server-side, never surfaced as a fabricated "email sent" state.
 */
export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
	const env = getServerEnv();
	if (!env.MAIL_API_KEY || !env.MAIL_FROM) {
		console.warn(`[mail] not configured (MAIL_API_KEY/MAIL_FROM missing) — email to ${input.to} NOT sent: "${input.subject}"`);
		return { ok: false, reason: "not_configured" };
	}

	try {
		const response = await fetch("https://api.resend.com/emails", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${env.MAIL_API_KEY}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				from: env.MAIL_FROM,
				to: input.to,
				subject: input.subject,
				html: input.html,
				text: input.text,
			}),
			signal: AbortSignal.timeout(10_000),
		});
		if (!response.ok) {
			console.error(`[mail] provider error sending to ${input.to}: HTTP ${response.status}`);
			return { ok: false, reason: "provider_error" };
		}
		return { ok: true };
	} catch (error) {
		console.error(`[mail] provider request failed sending to ${input.to}:`, error instanceof Error ? error.message : "unknown error");
		return { ok: false, reason: "provider_error" };
	}
}
