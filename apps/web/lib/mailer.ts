import nodemailer from 'nodemailer';

export async function sendPasswordResetEmail(
  toEmail: string,
  otp: string
): Promise<{ sent: boolean; reason?: string }> {
  const smtpHost = process.env.SMTP_HOST || '';
  const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
  const smtpUser = process.env.SMTP_USER || '';
  const smtpPass = process.env.SMTP_PASSWORD || '';
  const smtpFrom = process.env.SMTP_FROM || smtpUser || 'Quanteinstein <no-reply@quanteinstein.com>';
  const resendApiKey = process.env.RESEND_API_KEY || '';

  const subject = 'Quanteinstein — Password Recovery Code';
  const htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0b0f19; color: #e2e8f0; padding: 40px 20px; text-align: center;">
      <div style="max-width: 520px; margin: 0 auto; background-color: #111827; border: 1px solid #243044; border-radius: 16px; padding: 36px 28px; text-align: left;">
        <div style="margin-bottom: 24px;">
          <h2 style="color: #6366f1; margin: 0; font-size: 22px; font-weight: 800; display: inline-block;">Quanteinstein</h2>
          <span style="font-size: 11px; color: #64748b; border: 1px solid #1e293b; padding: 3px 8px; border-radius: 999px; margin-left: 10px;">Institutional Quant Lab</span>
        </div>
        
        <h3 style="color: #ffffff; margin-top: 0; font-size: 18px;">Password Recovery Request</h3>
        <p style="color: #94a3b8; font-size: 14px; line-height: 1.6;">
          We received a request to reset the password for your Quanteinstein paper trading account (<strong>${toEmail}</strong>).
        </p>
        
        <div style="background-color: #0d121f; border: 1px solid #2a3449; border-radius: 12px; padding: 20px; text-align: center; margin: 28px 0;">
          <div style="color: #94a3b8; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px;">Your One-Time Recovery Code</div>
          <div style="color: #38bdf8; font-size: 32px; font-weight: 900; letter-spacing: 0.25em; font-family: monospace;">${otp}</div>
          <div style="color: #64748b; font-size: 12px; margin-top: 8px;">Valid for 10 minutes</div>
        </div>
        
        <p style="color: #94a3b8; font-size: 13px; line-height: 1.5;">
          Enter this code in your browser terminal to choose a new password. If you did not initiate this request, you can safely disregard this message.
        </p>
        
        <hr style="border: 0; border-top: 1px solid #1e293b; margin: 28px 0;" />
        
        <div style="color: #64748b; font-size: 11px; text-align: center; line-height: 1.5;">
          Quanteinstein Institutional Research & Simulation · Zero Capital Risk<br />
          This is an automated security transmission. Do not reply to this email.
        </div>
      </div>
    </div>
  `;

  // 1. Try Resend API if configured
  if (resendApiKey) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: smtpFrom.includes('<') ? smtpFrom : `Quanteinstein <${smtpFrom}>`,
          to: [toEmail],
          subject,
          html: htmlContent,
        }),
      });
      if (res.ok) {
        return { sent: true };
      }
      const errData = await res.json().catch(() => ({}));
      console.warn('[Mailer] Resend delivery failed:', errData);
    } catch (e: any) {
      console.warn('[Mailer] Resend exception:', e.message);
    }
  }

  // 2. Try SMTP via Nodemailer if host configured
  if (smtpHost) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: smtpUser ? { user: smtpUser, pass: smtpPass } : undefined,
        tls: { rejectUnauthorized: false },
      });

      await transporter.sendMail({
        from: smtpFrom,
        to: toEmail,
        subject,
        html: htmlContent,
      });

      return { sent: true };
    } catch (e: any) {
      console.warn('[Mailer] SMTP delivery failed:', e.message);
      return { sent: false, reason: e.message };
    }
  }

  return { sent: false, reason: 'No SMTP or email provider credentials configured' };
}
