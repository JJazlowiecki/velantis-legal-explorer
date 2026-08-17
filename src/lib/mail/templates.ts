/** Minimal branded HTML/text transactional email bodies — no templating platform, plain functions. */

function shell(title: string, bodyHtml: string): string {
	return `<!doctype html><html><body style="margin:0;padding:0;background:#0a0a0a;font-family:system-ui,-apple-system,sans-serif;color:#e5e5e5;">
<table role="presentation" width="100%" style="background:#0a0a0a;padding:32px 0;">
<tr><td align="center">
<table role="presentation" width="480" style="background:#141414;border:1px solid #262626;border-radius:8px;padding:32px;">
<tr><td>
<div style="font-size:18px;font-weight:600;letter-spacing:0.02em;color:#fafafa;margin-bottom:24px;">Velantis Legal Explorer</div>
<div style="font-size:16px;font-weight:600;color:#fafafa;margin-bottom:12px;">${title}</div>
${bodyHtml}
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

export function resetPasswordEmail(resetUrl: string): { subject: string; html: string; text: string } {
	const subject = "Resetowanie hasła — Velantis Legal Explorer";
	const html = shell(
		"Resetowanie hasła",
		`<p style="font-size:14px;line-height:1.6;color:#d4d4d4;">Otrzymaliśmy prośbę o zresetowanie hasła do Twojego konta. Kliknij poniższy przycisk, aby ustawić nowe hasło. Link jest ważny przez ograniczony czas.</p>
<a href="${resetUrl}" style="display:inline-block;margin:16px 0;padding:12px 20px;background:#fafafa;color:#0a0a0a;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">Ustaw nowe hasło</a>
<p style="font-size:12px;line-height:1.6;color:#8a8a8a;">Jeśli to nie Ty prosiłeś/aś o reset hasła, zignoruj tę wiadomość — Twoje hasło pozostaje bez zmian.</p>`,
	);
	const text = `Resetowanie hasła — Velantis Legal Explorer\n\nOtrzymaliśmy prośbę o zresetowanie hasła. Otwórz poniższy link, aby ustawić nowe hasło:\n${resetUrl}\n\nJeśli to nie Ty prosiłeś/aś o reset hasła, zignoruj tę wiadomość.`;
	return { subject, html, text };
}

export function verificationEmail(verifyUrl: string): { subject: string; html: string; text: string } {
	const subject = "Potwierdź adres e-mail — Velantis Legal Explorer";
	const html = shell(
		"Potwierdź swój adres e-mail",
		`<p style="font-size:14px;line-height:1.6;color:#d4d4d4;">Dziękujemy za rejestrację. Potwierdź swój adres e-mail, klikając poniższy przycisk.</p>
<a href="${verifyUrl}" style="display:inline-block;margin:16px 0;padding:12px 20px;background:#fafafa;color:#0a0a0a;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">Potwierdź adres e-mail</a>
<p style="font-size:12px;line-height:1.6;color:#8a8a8a;">Jeśli nie zakładałeś/aś konta, zignoruj tę wiadomość.</p>`,
	);
	const text = `Potwierdź adres e-mail — Velantis Legal Explorer\n\nOtwórz poniższy link, aby potwierdzić swój adres e-mail:\n${verifyUrl}\n\nJeśli nie zakładałeś/aś konta, zignoruj tę wiadomość.`;
	return { subject, html, text };
}
