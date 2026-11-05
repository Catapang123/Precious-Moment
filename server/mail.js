/**
 * Transactional email for account recovery.
 *
 * Uses Resend's HTTPS API via Node's built-in fetch, so no SMTP package is
 * needed. Set RESEND_API_KEY and MAIL_FROM in production. When no key is set in
 * development, the reset link is printed to the server console so the flow can
 * be exercised; production never logs a token.
 */
import { APP_ORIGIN, IS_PROD, MAIL_FROM, RESEND_API_KEY } from './config.js';

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function message({ name, resetUrl, expiresMinutes }) {
  const safeName = escapeHtml(name || 'there');
  const safeUrl = escapeHtml(resetUrl);
  const text = [
    `Hi ${name || 'there'},`,
    '',
    'We received a request to reset your Precious Moments password.',
    `Choose a new password here: ${resetUrl}`,
    '',
    `This link expires in ${expiresMinutes} minutes and can be used once.`,
    'If you did not request this, you can ignore this email. Your current password stays the same.',
    '',
    'Precious Moments',
  ].join('\n');

  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#fff7f3;color:#351b27;font-family:Manrope,Segoe UI,sans-serif;padding:32px 18px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr><td align="center">
        <table role="presentation" width="100%" style="max-width:560px;background:#fffdfb;border:1px solid rgba(53,27,39,.13);border-radius:18px;overflow:hidden">
          <tr><td style="padding:30px 32px 8px">
            <p style="margin:0 0 14px;letter-spacing:.16em;text-transform:uppercase;font-size:11px;color:#991943">Precious Moments</p>
            <h1 style="margin:0;font-family:Georgia,serif;font-weight:400;font-size:32px;line-height:1.1">Reset your password</h1>
            <p style="margin:18px 0 0;font-size:14px;line-height:1.7;color:#725863">Hi ${safeName}, we received a request to reset the password for your Precious Moments account.</p>
          </td></tr>
          <tr><td style="padding:22px 32px">
            <a href="${safeUrl}" style="display:inline-block;background:#351b27;color:#fff7f3;text-decoration:none;padding:13px 20px;border-radius:999px;font-size:14px;font-weight:700">Choose a new password</a>
            <p style="margin:18px 0 0;font-size:12px;line-height:1.65;color:#725863">This link expires in ${expiresMinutes} minutes and can be used once. If you did not request it, ignore this email; your current password will stay the same.</p>
            <p style="margin:16px 0 0;font-size:11px;line-height:1.6;color:#9c858e;word-break:break-all">${safeUrl}</p>
          </td></tr>
          <tr><td style="padding:18px 32px 30px;border-top:1px solid rgba(53,27,39,.1)">
            <p style="margin:0;font-size:11px;color:#9c858e">Sent by Precious Moments. This is an automated account-security message.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  return { text, html, subject: 'Reset your Precious Moments password' };
}

/**
 * Sends a reset link. Returns the transport used. Throws when production email
 * is not configured, so the route can log the failure without exposing it to the
 * caller (the API response is always generic).
 */
export async function sendPasswordResetEmail({ to, name, resetUrl, expiresMinutes }) {
  const body = message({ name, resetUrl, expiresMinutes });
  if (!RESEND_API_KEY) {
    if (!IS_PROD) {
      console.log(`[development password reset] ${resetUrl}`);
      return { transport: 'development-console' };
    }
    throw new Error('Password-reset email is not configured. Set RESEND_API_KEY and MAIL_FROM.');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: MAIL_FROM,
      to: [to],
      subject: body.subject,
      text: body.text,
      html: body.html,
      reply_to: 'hello@preciousmoments.ph',
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Resend rejected the password-reset email (${response.status}) ${detail.slice(0, 200)}`);
  }
  return { transport: 'resend', origin: APP_ORIGIN };
}
