'use client';

import React, { useState, useEffect, useId } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ApiError, api, formatApiError, saveAuth } from '../../lib/api';
import { supabase } from '../../lib/supabaseClient';

type AuthMode = 'login' | 'register' | 'forgot_password';
type StatusType = 'info' | 'success' | 'error' | '';

export default function LoginForm() {
  const searchParams = useSearchParams();
  const expired = searchParams.get('expired') === '1';

  // Active view mode
  const [mode, setMode] = useState<AuthMode>('login');

  // Input states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [otp, setOtp] = useState('');
  const [resetOtp, setResetOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);

  // UI state
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [otpRequested, setOtpRequested] = useState(false);
  const [resetRequested, setResetRequested] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Status message & type
  const [statusMsg, setStatusMsg] = useState(
    expired
      ? 'Your session expired. Please sign in to resume paper trading.'
      : ''
  );
  const [statusType, setStatusType] = useState<StatusType>(expired ? 'error' : '');

  // Cooldown countdown effect
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // Set alert message helper
  function notify(msg: string, type: StatusType = 'info') {
    setStatusMsg(msg);
    setStatusType(type);
  }

  // Password strength score (0-4)
  function getPasswordStrength(pwd: string): { score: number; label: string; color: string } {
    if (!pwd) return { score: 0, label: '', color: '#475569' };
    let score = 0;
    if (pwd.length >= 6) score++;
    if (pwd.length >= 10) score++;
    if (/[0-9]/.test(pwd)) score++;
    if (/[^A-Za-z0-9]/.test(pwd)) score++;

    if (score <= 1) return { score: 1, label: 'Weak', color: '#ef4444' };
    if (score === 2) return { score: 2, label: 'Fair', color: '#f59e0b' };
    if (score === 3) return { score: 3, label: 'Good', color: '#3b82f6' };
    return { score: 4, label: 'Strong', color: '#10b981' };
  }

  const pwdStrength = getPasswordStrength(mode === 'register' ? password : newPassword);

  // -------------------------------------------------------------
  // Sign In Handler
  // -------------------------------------------------------------
  async function handleLogin(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!email.trim() || !password) {
      notify('Please enter your email and password.', 'error');
      return;
    }

    setBusy(true);
    notify('Authenticating credentials…', 'info');

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
              name:
                (data.user.user_metadata?.name as string) ||
                (data.user.user_metadata?.full_name as string) ||
                email.trim().split('@')[0],
              onboarding_completed: true,
            },
          });
          notify('Sign in successful. Entering Quanteinstein Terminal…', 'success');
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
            notify('Sign in successful. Entering Quanteinstein Terminal…', 'success');
            window.location.href = '/dashboard';
            return;
          } catch {
            notify('Authentication failed: ' + error.message, 'error');
            setBusy(false);
            return;
          }
        }
      } catch (err: any) {
        notify('Sign in error: ' + (err?.message || 'Authentication error'), 'error');
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
      notify('Sign in successful. Entering Quanteinstein Terminal…', 'success');
      window.location.href = '/dashboard';
    } catch (e) {
      notify('Sign in failed: ' + formatApiError(e), 'error');
      setBusy(false);
    }
  }

  // -------------------------------------------------------------
  // Registration OTP Request
  // -------------------------------------------------------------
  async function handleRequestOtp(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!name.trim()) {
      notify('Please enter your full name.', 'error');
      return;
    }
    if (!email.trim() || !password) {
      notify('Please enter your email and choose a password.', 'error');
      return;
    }
    if (password.length < 6) {
      notify('Password must be at least 6 characters long.', 'error');
      return;
    }

    setBusy(true);
    notify(otpRequested ? 'Resending verification code…' : 'Generating verification code…', 'info');

    // 1. Supabase Auth signup
    if (supabase) {
      try {
        const redirectUrl =
          typeof window !== 'undefined'
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
            window.alert('This email address is already registered. Please sign in instead.');
            setMode('login');
          }
          notify('Registration failed: ' + error.message, 'error');
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
          notify('Account verified! Entering terminal…', 'success');
          window.location.href = '/dashboard';
          return;
        }

        setOtpRequested(true);
        setResendCooldown(45);
        notify(
          `Verification code sent to ${email.trim()}. Enter the OTP below or click the link in your email.`,
          'info'
        );
        setBusy(false);
        return;
      } catch (err: any) {
        notify('Registration error: ' + (err?.message || 'Failed to sign up'), 'error');
        setBusy(false);
        return;
      }
    }

    // 2. Legacy API fallback
    try {
      const data = (await api('/auth/register/request-otp', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password, name: name.trim() }),
      })) as { message?: string; otp?: string };

      setOtpRequested(true);
      setResendCooldown(45);
      if (data.otp) setOtp(data.otp);
      notify(
        data.otp
          ? `Code generated: ${data.otp}. Enter it to finalize registration.`
          : (otpRequested ? 'Code resent. Please check your inbox.' : data.message || 'Verification code sent to your email.'),
        'info'
      );
    } catch (e) {
      const text = formatApiError(e);
      if (e instanceof ApiError && e.status === 409) {
        window.alert('This email address is already registered. Please sign in instead.');
        setMode('login');
      }
      notify('Verification request failed: ' + text, 'error');
    } finally {
      setBusy(false);
    }
  }

  // -------------------------------------------------------------
  // Verify Registration OTP
  // -------------------------------------------------------------
  async function handleVerifyOtp(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!email.trim() || !otp.trim()) {
      notify('Please enter your email and the verification code.', 'error');
      return;
    }

    setBusy(true);
    notify('Validating verification code…', 'info');

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
          notify('Verification failed: ' + error.message, 'error');
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
              name:
                (data.user.user_metadata?.name as string) ||
                name.trim() ||
                email.trim().split('@')[0],
              onboarding_completed: true,
            },
          });
          notify('Account verified! Redirecting to dashboard…', 'success');
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
                name:
                  (signInRes.data.user.user_metadata?.name as string) ||
                  name.trim() ||
                  email.trim().split('@')[0],
                onboarding_completed: true,
              },
            });
            notify('Account verified! Redirecting…', 'success');
            window.location.href = '/dashboard';
            return;
          }
        }

        notify('Email verified successfully! You can now sign in.', 'success');
        setMode('login');
        setOtpRequested(false);
        setBusy(false);
        return;
      } catch (err: any) {
        notify('OTP validation error: ' + (err?.message || 'Failed to verify code'), 'error');
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
      notify('Registration complete. Redirecting…', 'success');
      window.location.href = '/dashboard';
    } catch (e) {
      const text = formatApiError(e);
      if (e instanceof ApiError && e.status === 409) {
        window.alert('This email address is already registered. Please sign in instead.');
        setMode('login');
      }
      notify('Verification code error: ' + text, 'error');
      setBusy(false);
    }
  }

  // -------------------------------------------------------------
  // Password Reset Request
  // -------------------------------------------------------------
  async function handleRequestPasswordReset(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      notify('Please enter your account email address.', 'error');
      return;
    }

    setBusy(true);
    notify(resetRequested ? 'Resending recovery code…' : 'Generating recovery instructions…', 'info');

    // 1. Primary: Server-side Supabase Admin recovery route (generates OTP without broken external SMTP)
    try {
      const res = await fetch('/api/auth/password-reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.success) {
        setResetRequested(true);
        setResendCooldown(45);
        if (data.otp) {
          setResetOtp(data.otp);
          notify(
            `Recovery code generated: ${data.otp}. It has been entered below for you. Set your new password to proceed.`,
            'success'
          );
        } else {
          notify(
            data.message || 'Recovery code generated. Enter the code and your new password below.',
            'info'
          );
        }
        setBusy(false);
        return;
      }

      if (data.error) {
        if (data.error.includes('No account registered') || res.status === 404) {
          notify(data.error, 'error');
          setBusy(false);
          return;
        }
      }
    } catch (apiErr) {
      console.warn('Server password reset request failed, trying client fallback:', apiErr);
    }

    // 2. Client-side Supabase Auth fallback
    if (supabase) {
      try {
        const redirectUrl =
          typeof window !== 'undefined'
            ? `${window.location.origin}/login`
            : 'https://www.quanteinstein.com/login';

        const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
          redirectTo: redirectUrl,
        });

        if (!error) {
          setResetRequested(true);
          setResendCooldown(45);
          notify('Recovery instructions sent to your email. Enter the code and your new password below.', 'info');
          setBusy(false);
          return;
        }
        console.warn('Client Supabase reset error:', error.message);
      } catch (err: any) {
        console.warn('Client Supabase reset exception:', err);
      }
    }

    // 3. Legacy QuantOS API fallback
    try {
      const data = (await api('/auth/password-reset/request-otp', {
        method: 'POST',
        body: JSON.stringify({ email: cleanEmail }),
      })) as { message?: string; otp?: string };

      setResetRequested(true);
      setResendCooldown(45);
      if (data.otp) setResetOtp(data.otp);
      notify(
        data.otp
          ? `Recovery code generated: ${data.otp}. Enter it with your new password below.`
          : (resetRequested ? 'Recovery code resent. Check your inbox.' : data.message || 'Recovery instructions sent.'),
        'info'
      );
    } catch (e) {
      notify('Password recovery failed: ' + formatApiError(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  // -------------------------------------------------------------
  // Verify Password Reset & Update
  // -------------------------------------------------------------
  async function handleVerifyPasswordReset(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !resetOtp.trim() || !newPassword) {
      notify('Email, recovery code, and new password are all required.', 'error');
      return;
    }
    if (newPassword.length < 6) {
      notify('New password must be at least 6 characters long.', 'error');
      return;
    }

    setBusy(true);
    notify('Updating account password…', 'info');

    // 1. Primary: Server-side Supabase Admin verify & update
    try {
      const res = await fetch('/api/auth/password-reset/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cleanEmail,
          otp: resetOtp.trim(),
          new_password: newPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.success) {
        setPassword(newPassword);
        setResetRequested(false);
        setNewPassword('');
        setResetOtp('');
        notify('Password updated successfully! Signing you in…', 'success');

        // Automatically log in with new credentials
        if (supabase) {
          try {
            const { data: loginData } = await supabase.auth.signInWithPassword({
              email: cleanEmail,
              password: newPassword,
            });
            if (loginData?.session && loginData?.user) {
              saveAuth({
                token: loginData.session.access_token,
                refresh_token: loginData.session.refresh_token,
                user: {
                  id: loginData.user.id,
                  email: loginData.user.email || cleanEmail,
                  name: (loginData.user.user_metadata?.name as string) || cleanEmail.split('@')[0],
                  onboarding_completed: true,
                },
              });
              window.location.href = '/dashboard';
              return;
            }
          } catch {}
        }

        setMode('login');
        setBusy(false);
        return;
      }

      if (data.error && !data.error.includes('unavailable')) {
        notify(data.error, 'error');
        setBusy(false);
        return;
      }
    } catch (apiErr) {
      console.warn('Server password verify failed, trying client fallback:', apiErr);
    }

    // 2. Client-side Supabase Auth fallback
    if (supabase) {
      try {
        const { error: otpError } = await supabase.auth.verifyOtp({
          email: cleanEmail,
          token: resetOtp.trim(),
          type: 'recovery',
        });
        if (!otpError) {
          const { error: updateError } = await supabase.auth.updateUser({
            password: newPassword,
          });
          if (!updateError) {
            setPassword(newPassword);
            setResetRequested(false);
            setNewPassword('');
            setResetOtp('');
            notify('Password updated successfully! You can now sign in with your new password.', 'success');
            setMode('login');
            setBusy(false);
            return;
          }
        }
      } catch (err: any) {
        console.warn('Client Supabase verify exception:', err);
      }
    }

    // 3. Legacy QuantOS API fallback
    try {
      const data = (await api('/auth/password-reset/verify', {
        method: 'POST',
        body: JSON.stringify({
          email: cleanEmail,
          otp: resetOtp.trim(),
          new_password: newPassword,
        }),
      })) as { message?: string };
      setPassword(newPassword);
      setResetRequested(false);
      setNewPassword('');
      setResetOtp('');
      notify(data.message || 'Password successfully updated. Please sign in.', 'success');
      setMode('login');
    } catch (e) {
      notify('Password reset failed: ' + formatApiError(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{
      minHeight: 'calc(100vh - 56px)',
      background: 'radial-gradient(ellipse at 50% 0%, #151a2e 0%, #0a0d18 70%, #060810 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 20px',
      position: 'relative',
    }}>
      {/* Subtle grid background overlay */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundImage: `linear-gradient(rgba(99, 102, 241, 0.03) 1px, transparent 1px),
                          linear-gradient(90deg, rgba(99, 102, 241, 0.03) 1px, transparent 1px)`,
        backgroundSize: '40px 40px',
        pointerEvents: 'none',
      }} />

      <div style={{
        maxWidth: 1080,
        width: '100%',
        display: 'grid',
        gridTemplateColumns: 'minmax(320px, 1.15fr) minmax(340px, 1fr)',
        gap: 36,
        alignItems: 'center',
        position: 'relative',
        zIndex: 1,
      }}>

        {/* ------------------------------------------------------------- */}
        {/* LEFT COLUMN: Institutional Platform Overview & Highlights      */}
        {/* ------------------------------------------------------------- */}
        <div style={{ padding: '12px 16px' }}>
          {/* Top Badge */}
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            background: 'rgba(99, 102, 241, 0.12)',
            border: '1px solid rgba(99, 102, 241, 0.3)',
            borderRadius: 999,
            padding: '5px 14px',
            fontSize: 12,
            fontWeight: 700,
            color: '#a5b4fc',
            marginBottom: 20,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}>
            <span style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#10b981',
              boxShadow: '0 0 10px #10b981',
              display: 'inline-block',
            }} />
            Institutional Quant & Paper Trading Lab
          </div>

          <h1 style={{
            fontSize: 38,
            fontWeight: 900,
            lineHeight: 1.15,
            letterSpacing: '-0.03em',
            background: 'linear-gradient(135deg, #ffffff 40%, #c7d2fe 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            marginBottom: 14,
          }}>
            Quanteinstein
          </h1>

          <p style={{
            fontSize: 16,
            color: '#94a3b8',
            lineHeight: 1.6,
            marginBottom: 28,
            maxWidth: 480,
          }}>
            Formulate high-conviction algorithmic rules, backtest against authentic Binance klines, and execute live simulated paper trades with institutional-grade risk models.
          </p>

          {/* Key Feature Highlights */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 32 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
              <div style={{
                background: 'rgba(99, 102, 241, 0.15)',
                border: '1px solid rgba(99, 102, 241, 0.3)',
                borderRadius: 10,
                width: 38,
                height: 38,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18,
                flexShrink: 0,
              }}>
                ⚡
              </div>
              <div>
                <div style={{ color: '#f8fafc', fontWeight: 700, fontSize: 14 }}>Quant Strategy Studio</div>
                <div style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.45 }}>
                  Breakout & momentum parameter builder with automated dynamic stop-loss and multi-R profit targets.
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
              <div style={{
                background: 'rgba(16, 185, 129, 0.15)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                borderRadius: 10,
                width: 38,
                height: 38,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18,
                flexShrink: 0,
              }}>
                🛡️
              </div>
              <div>
                <div style={{ color: '#f8fafc', fontWeight: 700, fontSize: 14 }}>Zero Financial Risk Paper Trading</div>
                <div style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.45 }}>
                  Sub-second live Binance kline execution with $100,000 starting paper equity and authentic fill simulation.
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
              <div style={{
                background: 'rgba(6, 182, 212, 0.15)',
                border: '1px solid rgba(6, 182, 212, 0.3)',
                borderRadius: 10,
                width: 38,
                height: 38,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18,
                flexShrink: 0,
              }}>
                📊
              </div>
              <div>
                <div style={{ color: '#f8fafc', fontWeight: 700, fontSize: 14 }}>Real-Time Charting & Analytics</div>
                <div style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.45 }}>
                  Institutional TradingView Lightweight Charts across 202+ cryptocurrency markets with live WebSocket streams.
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
              <div style={{
                background: 'rgba(245, 158, 11, 0.15)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                borderRadius: 10,
                width: 38,
                height: 38,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18,
                flexShrink: 0,
              }}>
                🔒
              </div>
              <div>
                <div style={{ color: '#f8fafc', fontWeight: 700, fontSize: 14 }}>Enterprise Security & Privacy</div>
                <div style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.45 }}>
                  256-bit TLS encryption, Supabase Auth tokens, and isolated per-user trade storage.
                </div>
              </div>
            </div>
          </div>

          {/* Quick Metrics Bar */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 12,
            background: 'rgba(15, 23, 42, 0.6)',
            border: '1px solid #1e293b',
            borderRadius: 12,
            padding: '14px 18px',
          }}>
            <div>
              <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Markets</div>
              <div style={{ fontSize: 19, fontWeight: 800, color: '#38bdf8' }}>202+ Pairs</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Paper Equity</div>
              <div style={{ fontSize: 19, fontWeight: 800, color: '#4ade80' }}>$100,000</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Latency</div>
              <div style={{ fontSize: 19, fontWeight: 800, color: '#a78bfa' }}>Sub-Second</div>
            </div>
          </div>
        </div>


        {/* ------------------------------------------------------------- */}
        {/* RIGHT COLUMN: Modern Auth Terminal Card                       */}
        {/* ------------------------------------------------------------- */}
        <div style={{
          background: 'linear-gradient(180deg, #111827 0%, #0d121f 100%)',
          border: '1px solid #243044',
          borderRadius: 20,
          padding: '32px 30px',
          boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.05)',
        }}>

          {/* Status / Alert Banner */}
          {statusMsg && (
            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '12px 14px',
              borderRadius: 10,
              marginBottom: 20,
              fontSize: 13,
              lineHeight: 1.45,
              background:
                statusType === 'error'
                  ? 'rgba(239, 68, 68, 0.12)'
                  : statusType === 'success'
                  ? 'rgba(16, 185, 129, 0.12)'
                  : 'rgba(99, 102, 241, 0.12)',
              border: `1px solid ${
                statusType === 'error'
                  ? 'rgba(239, 68, 68, 0.35)'
                  : statusType === 'success'
                  ? 'rgba(16, 185, 129, 0.35)'
                  : 'rgba(99, 102, 241, 0.35)'
              }`,
              color:
                statusType === 'error'
                  ? '#fca5a5'
                  : statusType === 'success'
                  ? '#86efac'
                  : '#a5b4fc',
            }}>
              <span style={{ fontSize: 16 }}>
                {statusType === 'error' ? '⚠️' : statusType === 'success' ? '✓' : 'ℹ️'}
              </span>
              <div style={{ flex: 1 }}>{statusMsg}</div>
            </div>
          )}

          {/* MODE: FORGOT PASSWORD */}
          {mode === 'forgot_password' ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
                <h2 style={{ fontSize: 22, fontWeight: 800, color: '#f8fafc', margin: 0 }}>
                  Reset Password
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setStatusMsg('');
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    fontSize: 13,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 8px',
                  }}
                >
                  ← Back to Sign In
                </button>
              </div>

              {!resetRequested ? (
                /* Step 1: Request Reset Code */
                <form onSubmit={handleRequestPasswordReset}>
                  <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 20 }}>
                    Enter your account email address. We will send a secure verification code to reset your password.
                  </p>

                  <div style={{ marginBottom: 20 }}>
                    <label
                      htmlFor="reset-email"
                      style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#cbd5e1', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}
                    >
                      Email Address
                    </label>
                    <input
                      id="reset-email"
                      name="email"
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      disabled={busy}
                      placeholder="name@example.com"
                      autoComplete="username"
                      required
                      style={{
                        background: '#0a0e1a',
                        border: '1px solid #2a3449',
                        borderRadius: 10,
                        padding: '12px 14px',
                        fontSize: 14,
                        color: '#f8fafc',
                        width: '100%',
                      }}
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={busy || !email.trim()}
                    style={{
                      width: '100%',
                      background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: 10,
                      padding: '13px 20px',
                      fontSize: 14,
                      fontWeight: 700,
                      cursor: busy ? 'not-allowed' : 'pointer',
                      boxShadow: '0 4px 14px rgba(99, 102, 241, 0.35)',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {busy ? 'Sending Recovery Code…' : 'Send Reset Code →'}
                  </button>
                </form>
              ) : (
                /* Step 2: Enter OTP & New Password */
                <form onSubmit={handleVerifyPasswordReset}>
                  <div style={{
                    background: 'rgba(99, 102, 241, 0.08)',
                    border: '1px solid rgba(99, 102, 241, 0.25)',
                    borderRadius: 10,
                    padding: '10px 14px',
                    fontSize: 12,
                    color: '#c7d2fe',
                    marginBottom: 20,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}>
                    <div>
                      Recovery account:<br />
                      <strong style={{ color: '#ffffff' }}>{email}</strong>
                    </div>
                    <button
                      type="button"
                      onClick={() => setResetRequested(false)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#93c5fd',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Change
                    </button>
                  </div>

                  <div style={{ marginBottom: 16 }}>
                    <label
                      htmlFor="reset-otp"
                      style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#cbd5e1', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}
                    >
                      Recovery Code (OTP)
                    </label>
                    <input
                      id="reset-otp"
                      name="otp"
                      type="text"
                      inputMode="numeric"
                      value={resetOtp}
                      onChange={e => setResetOtp(e.target.value)}
                      disabled={busy}
                      placeholder="Enter 6-digit code"
                      autoComplete="one-time-code"
                      required
                      style={{
                        background: '#0a0e1a',
                        border: '1px solid #2a3449',
                        borderRadius: 10,
                        padding: '12px 14px',
                        fontSize: 16,
                        letterSpacing: '0.15em',
                        fontFamily: 'monospace',
                        color: '#f8fafc',
                        width: '100%',
                      }}
                    />
                  </div>

                  <div style={{ marginBottom: 20 }}>
                    <label
                      htmlFor="reset-new-password"
                      style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#cbd5e1', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}
                    >
                      New Password
                    </label>
                    <div style={{ position: 'relative' }}>
                      <input
                        id="reset-new-password"
                        name="password"
                        type={showNewPassword ? 'text' : 'password'}
                        value={newPassword}
                        onChange={e => setNewPassword(e.target.value)}
                        disabled={busy}
                        placeholder="At least 6 characters"
                        autoComplete="new-password"
                        required
                        style={{
                          background: '#0a0e1a',
                          border: '1px solid #2a3449',
                          borderRadius: 10,
                          padding: '12px 42px 12px 14px',
                          fontSize: 14,
                          color: '#f8fafc',
                          width: '100%',
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPassword(!showNewPassword)}
                        style={{
                          position: 'absolute',
                          right: 10,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          background: 'none',
                          border: 'none',
                          color: '#94a3b8',
                          cursor: 'pointer',
                          padding: 4,
                          fontSize: 14,
                        }}
                        aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                      >
                        {showNewPassword ? '👁️' : '🔒'}
                      </button>
                    </div>

                    {newPassword && (
                      <div style={{ marginTop: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>
                          <span>Password Strength</span>
                          <span style={{ color: pwdStrength.color, fontWeight: 700 }}>{pwdStrength.label}</span>
                        </div>
                        <div style={{ height: 4, background: '#1e293b', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{
                            width: `${(pwdStrength.score / 4) * 100}%`,
                            background: pwdStrength.color,
                            height: '100%',
                            transition: 'width 0.2s ease',
                          }} />
                        </div>
                      </div>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={busy || !resetOtp.trim() || !newPassword}
                    style={{
                      width: '100%',
                      background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: 10,
                      padding: '13px 20px',
                      fontSize: 14,
                      fontWeight: 700,
                      cursor: busy ? 'not-allowed' : 'pointer',
                      boxShadow: '0 4px 14px rgba(16, 185, 129, 0.3)',
                      marginBottom: 14,
                    }}
                  >
                    {busy ? 'Updating Password…' : 'Update Password & Sign In →'}
                  </button>

                  <div style={{ textAlign: 'center' }}>
                    <button
                      type="button"
                      onClick={handleRequestPasswordReset}
                      disabled={busy || resendCooldown > 0}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: resendCooldown > 0 ? '#64748b' : '#6366f1',
                        cursor: resendCooldown > 0 ? 'default' : 'pointer',
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend recovery code'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          ) : (
            /* MODE: SIGN IN / CREATE ACCOUNT TABS */
            <div>
              {/* Segmented Switcher */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                background: '#090d16',
                border: '1px solid #1e293b',
                borderRadius: 12,
                padding: 4,
                marginBottom: 24,
              }}>
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setStatusMsg('');
                  }}
                  style={{
                    background: mode === 'login' ? '#1e293b' : 'transparent',
                    color: mode === 'login' ? '#ffffff' : '#94a3b8',
                    border: 'none',
                    borderRadius: 8,
                    padding: '10px 16px',
                    fontSize: 14,
                    fontWeight: mode === 'login' ? 700 : 500,
                    cursor: 'pointer',
                    boxShadow: mode === 'login' ? '0 2px 8px rgba(0, 0, 0, 0.3)' : 'none',
                    transition: 'all 0.15s ease',
                  }}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('register');
                    setStatusMsg('');
                  }}
                  style={{
                    background: mode === 'register' ? '#1e293b' : 'transparent',
                    color: mode === 'register' ? '#ffffff' : '#94a3b8',
                    border: 'none',
                    borderRadius: 8,
                    padding: '10px 16px',
                    fontSize: 14,
                    fontWeight: mode === 'register' ? 700 : 500,
                    cursor: 'pointer',
                    boxShadow: mode === 'register' ? '0 2px 8px rgba(0, 0, 0, 0.3)' : 'none',
                    transition: 'all 0.15s ease',
                  }}
                >
                  Create Account
                </button>
              </div>

              {/* --------------------------------------------- */}
              {/* SUB-VIEW: SIGN IN FORM                        */}
              {/* --------------------------------------------- */}
              {mode === 'login' && (
                <form onSubmit={handleLogin}>
                  <div style={{ marginBottom: 18 }}>
                    <label
                      htmlFor="signin-email"
                      style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#cbd5e1', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}
                    >
                      Email Address
                    </label>
                    <input
                      id="signin-email"
                      name="email"
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      disabled={busy}
                      placeholder="name@example.com"
                      autoComplete="username"
                      required
                      style={{
                        background: '#0a0e1a',
                        border: '1px solid #2a3449',
                        borderRadius: 10,
                        padding: '12px 14px',
                        fontSize: 14,
                        color: '#f8fafc',
                        width: '100%',
                      }}
                    />
                  </div>

                  <div style={{ marginBottom: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <label
                        htmlFor="signin-password"
                        style={{ fontSize: 12, fontWeight: 700, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: '0.04em' }}
                      >
                        Password
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setMode('forgot_password');
                          setResetRequested(false);
                          setStatusMsg('');
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#818cf8',
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer',
                          padding: 0,
                        }}
                      >
                        Forgot password?
                      </button>
                    </div>

                    <div style={{ position: 'relative' }}>
                      <input
                        id="signin-password"
                        name="password"
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        disabled={busy}
                        placeholder="Enter your password"
                        autoComplete="current-password"
                        required
                        style={{
                          background: '#0a0e1a',
                          border: '1px solid #2a3449',
                          borderRadius: 10,
                          padding: '12px 42px 12px 14px',
                          fontSize: 14,
                          color: '#f8fafc',
                          width: '100%',
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        style={{
                          position: 'absolute',
                          right: 10,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          background: 'none',
                          border: 'none',
                          color: '#94a3b8',
                          cursor: 'pointer',
                          padding: 4,
                          fontSize: 14,
                        }}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? '👁️' : '🔒'}
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 22 }}>
                    <input
                      id="remember-me"
                      type="checkbox"
                      checked={rememberMe}
                      onChange={e => setRememberMe(e.target.checked)}
                      style={{ width: 'auto', accentColor: '#6366f1', cursor: 'pointer' }}
                    />
                    <label htmlFor="remember-me" style={{ fontSize: 13, color: '#94a3b8', cursor: 'pointer' }}>
                      Keep me signed in on this device
                    </label>
                  </div>

                  <button
                    type="submit"
                    disabled={busy || !email.trim() || !password}
                    style={{
                      width: '100%',
                      background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: 10,
                      padding: '13px 20px',
                      fontSize: 14,
                      fontWeight: 700,
                      cursor: busy ? 'not-allowed' : 'pointer',
                      boxShadow: '0 4px 14px rgba(99, 102, 241, 0.35)',
                      transition: 'all 0.15s ease',
                      marginBottom: 18,
                    }}
                  >
                    {busy ? 'Authenticating…' : 'Sign In to Terminal →'}
                  </button>

                  <div style={{
                    paddingTop: 16,
                    borderTop: '1px solid #1e293b',
                    fontSize: 12,
                    color: '#64748b',
                    textAlign: 'center',
                    lineHeight: 1.5,
                  }}>
                    Don&apos;t have an account yet?{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setMode('register');
                        setStatusMsg('');
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#a5b4fc',
                        fontWeight: 700,
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    >
                      Create free paper trading account
                    </button>
                  </div>
                </form>
              )}

              {/* --------------------------------------------- */}
              {/* SUB-VIEW: CREATE ACCOUNT FORM                 */}
              {/* --------------------------------------------- */}
              {mode === 'register' && (
                <div>
                  {!otpRequested ? (
                    <form onSubmit={handleRequestOtp}>
                      <div style={{ marginBottom: 16 }}>
                        <label
                          htmlFor="register-name"
                          style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#cbd5e1', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}
                        >
                          Full Name
                        </label>
                        <input
                          id="register-name"
                          name="name"
                          type="text"
                          value={name}
                          onChange={e => setName(e.target.value)}
                          disabled={busy}
                          placeholder="Alex Mercer"
                          autoComplete="name"
                          required
                          style={{
                            background: '#0a0e1a',
                            border: '1px solid #2a3449',
                            borderRadius: 10,
                            padding: '12px 14px',
                            fontSize: 14,
                            color: '#f8fafc',
                            width: '100%',
                          }}
                        />
                      </div>

                      <div style={{ marginBottom: 16 }}>
                        <label
                          htmlFor="register-email"
                          style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#cbd5e1', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}
                        >
                          Email Address
                        </label>
                        <input
                          id="register-email"
                          name="email"
                          type="email"
                          value={email}
                          onChange={e => setEmail(e.target.value)}
                          disabled={busy}
                          placeholder="name@example.com"
                          autoComplete="email"
                          required
                          style={{
                            background: '#0a0e1a',
                            border: '1px solid #2a3449',
                            borderRadius: 10,
                            padding: '12px 14px',
                            fontSize: 14,
                            color: '#f8fafc',
                            width: '100%',
                          }}
                        />
                      </div>

                      <div style={{ marginBottom: 20 }}>
                        <label
                          htmlFor="register-password"
                          style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#cbd5e1', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}
                        >
                          Create Password
                        </label>
                        <div style={{ position: 'relative' }}>
                          <input
                            id="register-password"
                            name="password"
                            type={showPassword ? 'text' : 'password'}
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            disabled={busy}
                            placeholder="Minimum 6 characters"
                            autoComplete="new-password"
                            required
                            style={{
                              background: '#0a0e1a',
                              border: '1px solid #2a3449',
                              borderRadius: 10,
                              padding: '12px 42px 12px 14px',
                              fontSize: 14,
                              color: '#f8fafc',
                              width: '100%',
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            style={{
                              position: 'absolute',
                              right: 10,
                              top: '50%',
                              transform: 'translateY(-50%)',
                              background: 'none',
                              border: 'none',
                              color: '#94a3b8',
                              cursor: 'pointer',
                              padding: 4,
                              fontSize: 14,
                            }}
                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                          >
                            {showPassword ? '👁️' : '🔒'}
                          </button>
                        </div>

                        {password && (
                          <div style={{ marginTop: 8 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>
                              <span>Security Strength</span>
                              <span style={{ color: pwdStrength.color, fontWeight: 700 }}>{pwdStrength.label}</span>
                            </div>
                            <div style={{ height: 4, background: '#1e293b', borderRadius: 2, overflow: 'hidden' }}>
                              <div style={{
                                width: `${(pwdStrength.score / 4) * 100}%`,
                                background: pwdStrength.color,
                                height: '100%',
                                transition: 'width 0.2s ease',
                              }} />
                            </div>
                          </div>
                        )}
                      </div>

                      <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5, marginBottom: 20 }}>
                        By registering, you agree to Quanteinstein&apos;s educational simulation terms. All trades are paper-executed with zero real monetary liability.
                      </div>

                      <button
                        type="submit"
                        disabled={busy || !name.trim() || !email.trim() || password.length < 6}
                        style={{
                          width: '100%',
                          background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: 10,
                          padding: '13px 20px',
                          fontSize: 14,
                          fontWeight: 700,
                          cursor: busy ? 'not-allowed' : 'pointer',
                          boxShadow: '0 4px 14px rgba(99, 102, 241, 0.35)',
                          marginBottom: 18,
                        }}
                      >
                        {busy ? 'Creating Account…' : 'Continue to Verification →'}
                      </button>

                      <div style={{
                        paddingTop: 16,
                        borderTop: '1px solid #1e293b',
                        fontSize: 12,
                        color: '#64748b',
                        textAlign: 'center',
                      }}>
                        Already have an account?{' '}
                        <button
                          type="button"
                          onClick={() => {
                            setMode('login');
                            setStatusMsg('');
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#a5b4fc',
                            fontWeight: 700,
                            cursor: 'pointer',
                            padding: 0,
                          }}
                        >
                          Sign In here
                        </button>
                      </div>
                    </form>
                  ) : (
                    /* Step 2: Verification OTP entry */
                    <form onSubmit={handleVerifyOtp}>
                      <div style={{
                        background: 'rgba(99, 102, 241, 0.08)',
                        border: '1px solid rgba(99, 102, 241, 0.25)',
                        borderRadius: 10,
                        padding: '12px 14px',
                        fontSize: 13,
                        color: '#c7d2fe',
                        marginBottom: 20,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}>
                        <div>
                          Verification code sent to:<br />
                          <strong style={{ color: '#ffffff' }}>{email}</strong>
                        </div>
                        <button
                          type="button"
                          onClick={() => setOtpRequested(false)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#93c5fd',
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          Edit
                        </button>
                      </div>

                      <div style={{ marginBottom: 20 }}>
                        <label
                          htmlFor="register-otp"
                          style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#cbd5e1', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}
                        >
                          Enter Verification Code
                        </label>
                        <input
                          id="register-otp"
                          name="otp"
                          type="text"
                          inputMode="numeric"
                          value={otp}
                          onChange={e => setOtp(e.target.value)}
                          disabled={busy}
                          placeholder="e.g. 123456"
                          autoComplete="one-time-code"
                          autoFocus
                          required
                          style={{
                            background: '#0a0e1a',
                            border: '1px solid #2a3449',
                            borderRadius: 10,
                            padding: '12px 14px',
                            fontSize: 18,
                            letterSpacing: '0.2em',
                            fontFamily: 'monospace',
                            color: '#f8fafc',
                            width: '100%',
                            textAlign: 'center',
                          }}
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={busy || !otp.trim()}
                        style={{
                          width: '100%',
                          background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: 10,
                          padding: '13px 20px',
                          fontSize: 14,
                          fontWeight: 700,
                          cursor: busy ? 'not-allowed' : 'pointer',
                          boxShadow: '0 4px 14px rgba(16, 185, 129, 0.3)',
                          marginBottom: 14,
                        }}
                      >
                        {busy ? 'Verifying Code…' : 'Verify OTP & Complete Registration →'}
                      </button>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <button
                          type="button"
                          onClick={() => setOtpRequested(false)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#94a3b8',
                            cursor: 'pointer',
                            fontSize: 12,
                          }}
                        >
                          ← Back to details
                        </button>

                        <button
                          type="button"
                          onClick={handleRequestOtp}
                          disabled={busy || resendCooldown > 0}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: resendCooldown > 0 ? '#64748b' : '#818cf8',
                            cursor: resendCooldown > 0 ? 'default' : 'pointer',
                            fontSize: 12,
                            fontWeight: 600,
                          }}
                        >
                          {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend verification code'}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Institutional Compliance Disclaimer */}
          <div style={{
            marginTop: 24,
            paddingTop: 16,
            borderTop: '1px solid #1e293b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            fontSize: 11,
            color: '#64748b',
          }}>
            <span>🔒 256-Bit TLS</span>
            <span>·</span>
            <span>📄 Simulation Only</span>
            <span>·</span>
            <span>⚡ Real-Time Binance Feeds</span>
          </div>

        </div>

      </div>

      {/* Responsive Stacking CSS for mobile devices */}
      <style jsx>{`
        @media (max-width: 860px) {
          div[style*="grid-template-columns: minmax(320px, 1.15fr) minmax(340px, 1fr)"] {
            grid-template-columns: 1fr !important;
            gap: 24px !important;
          }
        }
      `}</style>
    </div>
  );
}
