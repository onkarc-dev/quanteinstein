import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin';
import { sendRegistrationOtpEmail } from '../../../../../lib/mailer';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = (body?.email || '').trim().toLowerCase();
    const password = body?.password || '';
    const name = (body?.name || '').trim();

    if (!name) {
      return NextResponse.json({ error: 'Full name is required.' }, { status: 400 });
    }

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'A valid email address is required.' }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: 'Password must be at least 6 characters long.' },
        { status: 400 }
      );
    }

    if (!supabaseAdmin) {
      return NextResponse.json(
        { error: 'Authentication service is currently unavailable.' },
        { status: 503 }
      );
    }

    // 1. Check if user already exists
    const { data: userData } = await supabaseAdmin.auth.admin.listUsers();
    const existingUser = userData?.users?.find(
      (u: any) => u.email?.toLowerCase() === email
    );

    if (existingUser && existingUser.email_confirmed_at) {
      return NextResponse.json(
        { error: 'This email address is already registered. Please sign in instead.' },
        { status: 409 }
      );
    }

    // If unconfirmed existing user, clean up to allow fresh registration
    if (existingUser && !existingUser.email_confirmed_at) {
      try {
        await supabaseAdmin.auth.admin.deleteUser(existingUser.id);
      } catch (delErr) {
        console.warn('[Registration] Failed to remove unconfirmed stale user:', delErr);
      }
    }

    // 2. Generate signup link and OTP directly via Supabase Admin API
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'signup',
      email,
      password,
      options: {
        data: {
          name,
          full_name: name,
        },
      },
    });

    if (error) {
      const msg = error.message?.toLowerCase() || '';
      if (msg.includes('already registered') || msg.includes('exists') || (error as any).status === 409) {
        return NextResponse.json(
          { error: 'This email address is already registered. Please sign in instead.' },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const emailOtp = data?.properties?.email_otp || '';

    // 3. Dispatch verification email to user's inbox (NEVER return OTP in response payload)
    if (emailOtp) {
      const dispatchResult = await sendRegistrationOtpEmail(email, emailOtp, name);
      if (!dispatchResult.sent) {
        console.warn(`[Registration] Outbound OTP email not delivered for ${email}:`, dispatchResult.reason);
        return NextResponse.json(
          {
            error: `Email delivery failed (${dispatchResult.reason || 'SMTP configuration issue'}). Please verify your email address or check server configuration.`,
          },
          { status: 503 }
        );
      }
    } else {
      return NextResponse.json(
        { error: 'Failed to generate verification code. Please try again.' },
        { status: 500 }
      );
    }

    // Return sanitized success message
    return NextResponse.json({
      success: true,
      message: `A 6-digit verification code has been dispatched to ${email}. Please check your inbox and enter the code below to complete registration.`,
      email,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to process registration request.' },
      { status: 500 }
    );
  }
}
