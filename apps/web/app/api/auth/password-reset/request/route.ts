import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin';

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

    // Generate recovery link and OTP directly via Supabase Admin API
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
    const actionLink = data?.properties?.action_link || '';

    return NextResponse.json({
      success: true,
      message: emailOtp
        ? `Recovery code generated: ${emailOtp}. Enter it with your new password below.`
        : 'Recovery code generated. Enter the code and your new password below.',
      otp: emailOtp,
      action_link: actionLink,
      email,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to process password recovery request.' },
      { status: 500 }
    );
  }
}
