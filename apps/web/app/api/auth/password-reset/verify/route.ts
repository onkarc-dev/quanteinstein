import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = (body?.email || '').trim().toLowerCase();
    const otp = (body?.otp || '').trim();
    const newPassword = body?.new_password || '';

    if (!email || !otp || !newPassword) {
      return NextResponse.json(
        { error: 'Email, recovery code, and new password are required.' },
        { status: 400 }
      );
    }

    if (newPassword.length < 6) {
      return NextResponse.json(
        { error: 'Password must be at least 6 characters long.' },
        { status: 400 }
      );
    }

    if (!supabaseAdmin) {
      return NextResponse.json(
        { error: 'Admin auth service is currently unavailable.' },
        { status: 503 }
      );
    }

    // 1. Locate user by email in Supabase
    const { data: userData, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    if (listError) {
      return NextResponse.json(
        { error: listError.message || 'Unable to query user accounts.' },
        { status: 500 }
      );
    }

    const usersList: any[] = userData?.users || [];
    const targetUser = usersList.find(
      (u: any) => u.email?.toLowerCase() === email
    );

    if (!targetUser) {
      return NextResponse.json(
        { error: 'User account not found.' },
        { status: 404 }
      );
    }

    // 2. Update user's password directly via Supabase Admin API
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      targetUser.id,
      { password: newPassword }
    );

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message || 'Failed to update account password.' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Password updated successfully! You can now sign in with your new password.',
      user_id: targetUser.id,
      email,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to verify and update password.' },
      { status: 500 }
    );
  }
}
