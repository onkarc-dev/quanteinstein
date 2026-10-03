'use client';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ApiError, api, formatApiError, saveAuth } from '../../lib/api';
import { supabase } from '../../lib/supabaseClient';

export default function LoginForm() {
  const searchParams = useSearchParams();
  const expired = searchParams.get('expired') === '1';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [otp, setOtp] = useState('');
  const [resetOtp, setResetOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [resetRequested, setResetRequested] = useState(false);
  const [otpRequested, setOtpRequested] = useState(false);
  const [msg, setMsg] = useState(
    expired
      ? 'Your session expired. Please log in again.'
      : 'Existing users can log in. New users can register using email OTP.'
  );
  const [busy, setBusy] = useState(false);

  async function login() {
    if (!email.trim() || !password) {
      setMsg('Enter your email and password.');
      return;
    }
    setBusy(true);
    setMsg('Logging in…');

    // 1. Supabase Auth (24/7 direct authentication)
    if (supabase) {
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (!error && data.session && data.user) {
          saveAuth({
            token: data.session.access_token,
            refresh_token: data.session.refresh_token,
            user: {
              id: data.user.id,
              email: data.user.email || email.trim(),
              name: (data.user.user_metadata?.name as string) || (data.user.user_metadata?.full_name as string) || email.trim().split('@')[0],
              onboarding_completed: true,
            },
          });
          setMsg('Login successful. Redirecting…');
          window.location.href = '/dashboard';
          return;
        }

        if (error) {
          // If Supabase has user/password error, attempt fallback to legacy API in case account was created on old engine
          try {
            const legacyData = await api('/auth/login', {
              method: 'POST',
              body: JSON.stringify({ email: email.trim(), password }),
            });
            saveAuth(legacyData);
            setMsg('Login successful. Redirecting…');
            window.location.href = '/dashboard';
            return;
          } catch {
            setMsg('Login failed: ' + error.message);
            setBusy(false);
            return;
          }
        }
      } catch (err: any) {
        setMsg('Login failed: ' + (err?.message || 'Authentication error'));
        setBusy(false);
        return;
      }
    }

    // 2. Legacy API fallback
    try {
      const data = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password }),
      });
      saveAuth(data);
      setMsg('Login successful. Redirecting…');
      window.location.href = '/dashboard';
    } catch (e) {
      setMsg('Login failed: ' + formatApiError(e));
      setBusy(false);
    }
  }

  async function requestOtp() {
    if (!name.trim()) {
      setMsg('Enter your name to register.');
      return;
    }
    if (!email.trim() || !password) {
      setMsg('Enter your email and create a password to register.');
      return;
    }
    if (password.length < 6) {
      setMsg('Password must be at least 6 characters.');
      return;
    }
    setBusy(true);
    setMsg(otpRequested ? 'Resending OTP…' : 'Generating OTP…');

    // 1. Supabase Auth signup
    if (supabase) {
      try {
        const redirectUrl = typeof window !== 'undefined'
          ? `${window.location.origin}/dashboard`
          : 'https://www.quanteinstein.com/dashboard';

        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: redirectUrl,
            data: {
              name: name.trim(),
              full_name: name.trim(),
            },
          },
        });

        if (error) {
          if (error.message.toLowerCase().includes('already registered')) {
            window.alert('This email id is already registered. Please log in instead.');
          }
          setMsg('Registration failed: ' + error.message);
          setBusy(false);
          return;
        }

        // Direct session return if email confirmation is disabled/auto-confirmed
        if (data.session && data.user) {
          saveAuth({
            token: data.session.access_token,
            refresh_token: data.session.refresh_token,
            user: {
              id: data.user.id,
              email: data.user.email || email.trim(),
              name: name.trim(),
              onboarding_completed: true,
            },
          });
          setMsg('Registration complete. Redirecting to dashboard…');
          window.location.href = '/dashboard';
          return;
        }

        setOtpRequested(true);
        setMsg('Confirmation email sent to ' + email.trim() + '! Click the confirmation link in the email or enter the verification code below.');
        setBusy(false);
        return;
      } catch (err: any) {
        setMsg('Registration error: ' + (err?.message || 'Failed to sign up'));
        setBusy(false);
        return;
      }
    }

    // 2. Legacy API fallback
    try {
      const data = await api('/auth/register/request-otp', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password, name: name.trim() }),
      }) as { message?: string; otp?: string };
      setOtpRequested(true);
      if (data.otp) setOtp(data.otp);
      setMsg(
        data.otp
          ? `OTP generated: ${data.otp}. Enter it and click Verify OTP & Register.`
          : (otpRequested ? 'OTP resent. Check your email.' : data.message || 'OTP sent. Check your email.')
      );
    } catch (e) {
      const text = formatApiError(e);
      if (e instanceof ApiError && e.status === 409) {
        window.alert('This email id is already registered. Please log in instead.');
      }
      setMsg('Registration OTP failed: ' + text);
    } finally {
      setBusy(false);
    }
  }

  async function requestPasswordReset() {
    if (!email.trim()) {
      setMsg('Enter your email first.');
      return;
    }
    setBusy(true);
    setMsg(resetRequested ? 'Resending password reset code…' : 'Sending password reset code…');

    // 1. Supabase Auth password reset
    if (supabase) {
      try {
        const redirectUrl = typeof window !== 'undefined'
          ? `${window.location.origin}/login`
          : 'https://www.quanteinstein.com/login';

        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: redirectUrl,
        });
        if (error) {
          setMsg('Password reset failed: ' + error.message);
          setBusy(false);
          return;
        }
        setResetRequested(true);
        setMsg('Password reset code sent to your email. Enter the code and your new password below.');
        setBusy(false);
        return;
      } catch (err: any) {
        setMsg('Password reset error: ' + (err?.message || 'Failed to request reset'));
        setBusy(false);
        return;
      }
    }

    // 2. Legacy API fallback
    try {
      const data = await api('/auth/password-reset/request-otp', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim() }),
      }) as { message?: string; otp?: string };
      setResetRequested(true);
      if (data.otp) setResetOtp(data.otp);
      setMsg(
        data.otp
          ? `Reset OTP generated: ${data.otp}. Enter it with your new password.`
          : (resetRequested ? 'Reset OTP resent. Check your email.' : data.message || 'Reset OTP sent.')
      );
    } catch (e) {
      setMsg('Password reset failed: ' + formatApiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function verifyPasswordReset() {
    if (!email.trim() || !resetOtp.trim() || !newPassword) {
      setMsg('Email, reset OTP and new password are required.');
      return;
    }
    if (newPassword.length < 6) {
      setMsg('New password must be at least 6 characters.');
      return;
    }
    setBusy(true);
    setMsg('Updating password…');

    // 1. Supabase Auth verify OTP + update user password
    if (supabase) {
      try {
        const { error: otpError } = await supabase.auth.verifyOtp({
          email: email.trim(),
          token: resetOtp.trim(),
          type: 'recovery',
        });
        if (otpError) {
          setMsg('Invalid reset code: ' + otpError.message);
          setBusy(false);
          return;
        }
        const { error: updateError } = await supabase.auth.updateUser({
          password: newPassword,
        });
        if (updateError) {
          setMsg('Failed to update password: ' + updateError.message);
          setBusy(false);
          return;
        }
        setPassword(newPassword);
        setResetRequested(false);
        setNewPassword('');
        setResetOtp('');
        setMsg('Password updated successfully! You can now log in with your new password.');
        setBusy(false);
        return;
      } catch (err: any) {
        setMsg('Password reset error: ' + (err?.message || 'Failed to update password'));
        setBusy(false);
        return;
      }
    }

    // 2. Legacy API fallback
    try {
      const data = await api('/auth/password-reset/verify', {
        method: 'POST',
        body: JSON.stringify({
          email: email.trim(),
          otp: resetOtp.trim(),
          new_password: newPassword,
        }),
      }) as { message?: string };
      setPassword(newPassword);
      setResetRequested(false);
      setNewPassword('');
      setResetOtp('');
      setMsg(data.message || 'Password updated. Please log in.');
    } catch (e) {
      setMsg('Password reset failed: ' + formatApiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp() {
    if (!email.trim() || !otp.trim()) {
      setMsg('Enter your email and registration OTP.');
      return;
    }
    setBusy(true);
    setMsg('Verifying OTP…');

    // 1. Supabase Auth verify OTP
    if (supabase) {
      try {
        let { data, error } = await supabase.auth.verifyOtp({
          email: email.trim(),
          token: otp.trim(),
          type: 'signup',
        });

        if (error) {
          const secondAttempt = await supabase.auth.verifyOtp({
            email: email.trim(),
            token: otp.trim(),
            type: 'email',
          });
          if (!secondAttempt.error) {
            data = secondAttempt.data;
            error = null;
          }
        }

        if (error) {
          setMsg('OTP verification failed: ' + error.message);
          setBusy(false);
          return;
        }

        if (data?.session && data?.user) {
          saveAuth({
            token: data.session.access_token,
            refresh_token: data.session.refresh_token,
            user: {
              id: data.user.id,
              email: data.user.email || email.trim(),
              name: (data.user.user_metadata?.name as string) || name.trim() || email.trim().split('@')[0],
              onboarding_completed: true,
            },
          });
          setMsg('Registration complete. Redirecting…');
          window.location.href = '/dashboard';
          return;
        }

        if (password) {
          const signInRes = await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
          });
          if (signInRes.data.session && signInRes.data.user) {
            saveAuth({
              token: signInRes.data.session.access_token,
              refresh_token: signInRes.data.session.refresh_token,
              user: {
                id: signInRes.data.user.id,
                email: signInRes.data.user.email || email.trim(),
                name: (signInRes.data.user.user_metadata?.name as string) || name.trim() || email.trim().split('@')[0],
                onboarding_completed: true,
              },
            });
            setMsg('Registration complete. Redirecting…');
            window.location.href = '/dashboard';
            return;
          }
        }

        setMsg('Email verified successfully! You can now log in above.');
        setBusy(false);
        return;
      } catch (err: any) {
        setMsg('OTP verification error: ' + (err?.message || 'Failed to verify OTP'));
        setBusy(false);
        return;
      }
    }

    // 2. Legacy API fallback
    try {
      const data = await api('/auth/register/verify', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), otp: otp.trim() }),
      });
      saveAuth(data);
      setMsg('Registration complete. Redirecting…');
      window.location.href = '/dashboard';
    } catch (e) {
      const text = formatApiError(e);
      if (e instanceof ApiError && e.status === 409) {
        window.alert('This email id is already registered. Please log in instead.');
      }
      setMsg('OTP verification failed: ' + text);
      setBusy(false);
    }
  }

  return (
    <>
      <div className="hero">
        <h1>Quanteinstein</h1>
        <p className="muted">Trade Daily, Trade Safely</p>
        <p className="muted">Existing users log in with email and password. First-time users register with email OTP.</p>
      </div>

      <div className="card" style={{ maxWidth: 720 }}>
        <h2>Login</h2>
        <label>
          Email
          <input
            value={email}
            onChange={e => {
              setEmail(e.target.value);
              setOtpRequested(false);
              setResetRequested(false);
            }}
            disabled={busy}
            placeholder="Enter your email"
            autoComplete="email"
          />
        </label>
        <br /><br />

        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            disabled={busy}
            placeholder="Enter your password"
            autoComplete="current-password"
          />
        </label>
        <br /><br />

        <button onClick={login} disabled={busy}>Login</button>{' '}
        <button className="secondary" onClick={requestPasswordReset} disabled={busy}>
          {resetRequested ? 'Resend reset OTP' : 'Forgot password?'}
        </button>

        {resetRequested && (
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #243044' }}>
            <h3>Reset Password</h3>
            <label>
              Reset OTP
              <input
                value={resetOtp}
                onChange={e => setResetOtp(e.target.value)}
                disabled={busy}
                placeholder="Enter reset OTP"
                autoComplete="one-time-code"
              />
            </label>
            <br /><br />
            <label>
              New password
              <input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                disabled={busy}
                placeholder="Create new password"
                autoComplete="new-password"
              />
            </label>
            <br /><br />
            <button className="secondary" onClick={verifyPasswordReset} disabled={busy}>Verify Reset OTP</button>
          </div>
        )}

        <div style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid #243044' }}>
          <h2>New User Registration</h2>
          <label>
            Name
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              disabled={busy}
              placeholder="Enter your name"
              autoComplete="name"
            />
          </label>
          <br /><br />

          <p className="muted">Use the same email and password fields above, then generate OTP.</p>

          <button className="secondary" onClick={requestOtp} disabled={busy}>
            {otpRequested ? 'Resend OTP' : 'Generate OTP'}
          </button>{' '}

          {otpRequested && (
            <>
              <br /><br />
              <label>
                Registration OTP
                <input
                  value={otp}
                  onChange={e => setOtp(e.target.value)}
                  disabled={busy}
                  placeholder="Enter registration OTP"
                  autoComplete="one-time-code"
                />
              </label>
              <br /><br />
              <button className="secondary" onClick={verifyOtp} disabled={busy}>Verify OTP & Register</button>
            </>
          )}
        </div>

        <p className="muted">{msg}</p>
      </div>
    </>
  );
}
