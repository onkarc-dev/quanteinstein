import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin';
import { sendPasswordResetEmail } from '../../../../../lib/mailer';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = (body?.email || '').trim().toLowerCase();

    if (!email) {
      return NextResponse.json({ error: 'Email address is required.' }, { status: 400 });
    }

    if (!supabaseAdmin) {
      return NextResponse.json(
        { error: 'Admin auth service is currently unavailable.' },
        { status: 503 }
      );
    }

    // 1. Generate recovery link and OTP directly via Supabase Admin API
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: {
        redirectTo: 'https://www.quanteinstein.com/login',
      },
    });

    if (error) {
      const msg = error.message?.toLowerCase() || '';
      if (msg.includes('not found') || (error as any).status === 404) {
        return NextResponse.json(
          { error: 'No account registered with this email address. Please check your spelling or register a new account.' },
          { status: 404 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const emailOtp = data?.properties?.email_otp || '';

    // 2. Dispatch email to user's inbox (NEVER return OTP in response)
    if (emailOtp) {
      const dispatchResult = await sendPasswordResetEmail(email, emailOtp);
      if (!dispatchResult.sent) {
        console.warn(`[PasswordReset] Outbound email not delivered for ${email}:`, dispatchResult.reason);
      }
    }

    // Return safe, sanitized message without OTP
    return NextResponse.json({
      success: true,
      message: 'A verification code has been dispatched to your email address. Please check your inbox (and spam folder) and enter the code below.',
      email,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to process password recovery request.' },
      { status: 500 }
    );
  }
}
