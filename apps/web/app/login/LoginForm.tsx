'use client';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ApiError, api, formatApiError, saveAuth } from '../../lib/api';

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
    setMsg(resetRequested ? 'Resending password reset OTP…' : 'Sending password reset OTP…');
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
