import nodemailer from 'nodemailer';

const DEFAULT_SENDER_EMAIL = 'onkarchouguletrader@gmail.com';
const DEFAULT_SENDER_NAME = 'Quanteinstein';

export async function sendPasswordResetEmail(
  toEmail: string,
  otp: string
): Promise<{ sent: boolean; reason?: string }> {
  // Gmail & SMTP credentials
  const gmailPass = (
    process.env.GMAIL_APP_PASSWORD ||
    process.env.SMTP_PASSWORD ||
    ''
  ).trim();

  const smtpUser = (
    process.env.GMAIL_USER ||
    process.env.SMTP_USER ||
    DEFAULT_SENDER_EMAIL
  ).trim();

  const smtpHost = (
    process.env.SMTP_HOST ||
    (smtpUser.endsWith('@gmail.com') ? 'smtp.gmail.com' : '')
  ).trim();

  const smtpPort = parseInt(process.env.SMTP_PORT || '465', 10);
  const smtpSecure = smtpPort === 465;

  const smtpFrom =
    process.env.SMTP_FROM ||
    `"${DEFAULT_SENDER_NAME}" <${smtpUser || DEFAULT_SENDER_EMAIL}>`;

  const resendApiKey = process.env.RESEND_API_KEY || '';

  const subject = 'Quanteinstein — Your OTP to Reset Your Password';
  const textContent = `Hello,

Here is your OTP to reset your password for your Quanteinstein account (${toEmail}):

${otp}

This OTP is valid for 10 minutes. Enter it on the password reset screen to set your new password.
If you did not request a password reset, you can safely ignore this email.

Best regards,
Quanteinstein Lab
Sent from ${smtpUser || DEFAULT_SENDER_EMAIL}`;

  const htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0b0f19; color: #e2e8f0; padding: 40px 20px; text-align: center;">
      <div style="max-width: 520px; margin: 0 auto; background-color: #111827; border: 1px solid #243044; border-radius: 16px; padding: 36px 28px; text-align: left;">
        <div style="margin-bottom: 24px;">
          <h2 style="color: #6366f1; margin: 0; font-size: 22px; font-weight: 800; display: inline-block;">Quanteinstein</h2>
          <span style="font-size: 11px; color: #64748b; border: 1px solid #1e293b; padding: 3px 8px; border-radius: 999px; margin-left: 10px;">Institutional Quant Lab</span>
        </div>
        
        <h3 style="color: #ffffff; margin-top: 0; font-size: 18px;">Password Reset Request</h3>
        <p style="color: #94a3b8; font-size: 14px; line-height: 1.6;">
          Hello,<br /><br />
          Here is your OTP to reset your password for your Quanteinstein paper trading account (<strong>${toEmail}</strong>):
        </p>
        
        <div style="background-color: #0d121f; border: 1px solid #2a3449; border-radius: 12px; padding: 22px; text-align: center; margin: 26px 0;">
          <div style="color: #94a3b8; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px;">Your Password Reset OTP</div>
          <div style="color: #38bdf8; font-size: 34px; font-weight: 900; letter-spacing: 0.25em; font-family: monospace;">${otp}</div>
          <div style="color: #64748b; font-size: 12px; margin-top: 8px;">Valid for 10 minutes · Do not share this OTP with anyone</div>
        </div>
        
        <p style="color: #94a3b8; font-size: 13px; line-height: 1.5;">
          Enter this OTP on the Quanteinstein reset page to choose your new password. If you did not request this password reset, you can safely ignore this email.
        </p>
        
        <hr style="border: 0; border-top: 1px solid #1e293b; margin: 28px 0;" />
        
        <div style="color: #64748b; font-size: 11px; text-align: center; line-height: 1.5;">
          Sent by <strong>${smtpUser || DEFAULT_SENDER_EMAIL}</strong> for Quanteinstein Platform<br />
          Paper Trading & Simulation Only · Zero Capital Risk
        </div>
      </div>
    </div>
  `;

  // 1. Try Gmail / SMTP via Nodemailer
  if (gmailPass && smtpHost) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        auth: {
          user: smtpUser,
          pass: gmailPass,
        },
        tls: { rejectUnauthorized: false },
      });

      await transporter.sendMail({
        from: smtpFrom,
        to: toEmail,
        subject,
        text: textContent,
        html: htmlContent,
      });

      console.info(`[Mailer] Successfully dispatched reset OTP to ${toEmail} from ${smtpUser}`);
      return { sent: true };
    } catch (e: any) {
      console.warn(`[Mailer] SMTP delivery failed from ${smtpUser}:`, e.message);
      return { sent: false, reason: e.message };
    }
  }

  // 2. Try Resend API if configured
  if (resendApiKey) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: smtpFrom,
          to: [toEmail],
          subject,
          text: textContent,
          html: htmlContent,
        }),
      });
      if (res.ok) {
        return { sent: true };
      }
      const errData = await res.json().catch(() => ({}));
      console.warn('[Mailer] Resend delivery failed:', errData);
      return { sent: false, reason: errData?.message || 'Resend error' };
    } catch (e: any) {
      console.warn('[Mailer] Resend exception:', e.message);
      return { sent: false, reason: e.message };
    }
  }

  return {
    sent: false,
    reason: `Missing Google App Password for ${smtpUser}. Please provide GMAIL_APP_PASSWORD in environment variables.`,
  };
}
