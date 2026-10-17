import { NextResponse } from 'next/server';
import { supabase } from '../../../../../lib/supabaseClient';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = (body?.email || '').trim().toLowerCase();
    const otp = (body?.otp || '').trim();
    const password = body?.password || '';

    if (!email || !otp) {
      return NextResponse.json(
        { error: 'Email and verification code are required.' },
        { status: 400 }
      );
    }

    if (!supabase) {
      return NextResponse.json(
        { error: 'Authentication service is currently unavailable.' },
        { status: 503 }
      );
    }

    // 1. Verify OTP with Supabase Auth
    let { data, error } = await supabase.auth.verifyOtp({
      email,
      token: otp,
      type: 'signup',
    });

    if (error) {
      const secondAttempt = await supabase.auth.verifyOtp({
        email,
        token: otp,
        type: 'email',
      });
      if (!secondAttempt.error) {
        data = secondAttempt.data;
        error = null;
      }
    }

    if (error) {
      return NextResponse.json(
        { error: error.message || 'Invalid or expired verification code. Please request a new code.' },
        { status: 400 }
      );
    }

    // 2. Return session if directly established
    if (data?.session && data?.user) {
      return NextResponse.json({
        success: true,
        token: data.session.access_token,
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        user: {
          id: data.user.id,
          email: data.user.email || email,
          name:
            (data.user.user_metadata?.name as string) ||
            (data.user.user_metadata?.full_name as string) ||
            email.split('@')[0],
          onboarding_completed: true,
        },
      });
    }

    // 3. If OTP verified email but session not automatically issued, sign in with credentials
    if (password) {
      const signInRes = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInRes.data?.session && signInRes.data?.user) {
        return NextResponse.json({
          success: true,
          token: signInRes.data.session.access_token,
          access_token: signInRes.data.session.access_token,
          refresh_token: signInRes.data.session.refresh_token,
          user: {
            id: signInRes.data.user.id,
            email: signInRes.data.user.email || email,
            name:
              (signInRes.data.user.user_metadata?.name as string) ||
              (signInRes.data.user.user_metadata?.full_name as string) ||
              email.split('@')[0],
            onboarding_completed: true,
          },
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Email verified successfully! You can now sign in with your credentials.',
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to verify code.' },
      { status: 500 }
    );
  }
}
