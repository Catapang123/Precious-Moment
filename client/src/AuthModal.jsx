import React, { useEffect, useRef, useState } from 'react';
import { api } from './api';

const PASSWORD_RULES = [
  ['At least 10 characters', (value) => value.length >= 10],
  ['One uppercase letter', (value) => /[A-Z]/.test(value)],
  ['One lowercase letter', (value) => /[a-z]/.test(value)],
  ['One number', (value) => /\d/.test(value)],
  ['One symbol', (value) => /[^A-Za-z0-9]/.test(value)],
];

function validateRegistration({ name, email, password }) {
  if (name.trim().length < 2) return 'Enter your full name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Enter a valid email address.';
  if (!PASSWORD_RULES.every(([, test]) => test(password))) {
    return 'Use at least 10 characters with uppercase, lowercase, a number, and a symbol.';
  }
  return '';
}

export default function AuthModal({ open, initialMode = 'register', reason = '', onClose, onSuccess }) {
  const [mode, setMode] = useState(initialMode);
  const [step, setStep] = useState('form');
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' });
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const firstField = useRef(null);
  const dialog = useRef(null);

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setStep('form');
    setError('');
    setBusy(false);
    setCode('');
    setShowPassword(false);
    const timer = window.setTimeout(() => firstField.current?.focus(), 80);
    return () => window.clearTimeout(timer);
  }, [open, initialMode]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event) => {
      if (event.key === 'Escape' && !busy) onClose();
      if (event.key === 'Tab' && dialog.current) {
        const focusable = dialog.current.querySelectorAll(
          'button:not([disabled]), input:not([disabled]), a[href], select:not([disabled]), textarea:not([disabled])'
        );
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setError('');
  };

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (mode === 'register') {
      const problem = validateRegistration(form);
      if (problem) return setError(problem);
    } else {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return setError('Enter a valid email address.');
      if (!form.password) return setError('Enter your password.');
    }
    setBusy(true);
    try {
      const result =
        mode === 'register'
          ? await api('/api/auth/register', {
              method: 'POST',
              body: JSON.stringify({
                name: form.name.trim(),
                email: form.email.trim(),
                phone: form.phone.trim(),
                password: form.password,
              }),
            })
          : await api('/api/auth/login', {
              method: 'POST',
              body: JSON.stringify({ email: form.email.trim(), password: form.password }),
            });
      if (result.mfa_required) {
        setStep('mfa');
        setBusy(false);
        return;
      }
      if (result.user) {
        onSuccess(result.user);
        return;
      }
      setError('The studio did not return an account. Please try again.');
    } catch (problem) {
      setError(problem.message || 'Could not complete that. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function verifyMfa(event) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code.replace(/\s+/g, ''))) {
      return setError('Enter the 6-digit code from your authenticator app.');
    }
    setBusy(true);
    setError('');
    try {
      const result = await api('/api/auth/mfa', {
        method: 'POST',
        body: JSON.stringify({ code: code.replace(/\s+/g, '') }),
      });
      if (result.user) onSuccess(result.user);
      else setError('The code was accepted but the session could not be restored. Please sign in again.');
    } catch (problem) {
      setError(problem.message || 'That code could not be verified.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shop-overlay shop-overlay--center" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <div className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title" ref={dialog}>
        <button className="icon-button auth-close" type="button" onClick={onClose} disabled={busy} aria-label="Close">
          ×
        </button>
        <div className="auth-brand">
          <span className="brand-seal">PM</span>
          <div>
            <strong>Precious Moments</strong>
            <span>Prints, photo &amp; booths</span>
          </div>
        </div>

        {step === 'mfa' ? (
          <>
            <p className="eyebrow">Two-step verification</p>
            <h2 id="auth-title">One more moment.</h2>
            <p className="auth-lead">Enter the 6-digit code from your authenticator app to finish signing in.</p>
            <form onSubmit={verifyMfa} className="auth-form">
              <label className="shop-field">
                <span>Authenticator code</span>
                <input
                  className="shop-input code-input"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(event) => {
                    setCode(event.target.value.replace(/\D/g, '').slice(0, 6));
                    setError('');
                  }}
                  autoFocus
                />
              </label>
              {error ? <p className="shop-error" role="alert">{error}</p> : null}
              <button className="shop-button shop-button--primary" type="submit" disabled={busy}>
                {busy ? 'Checking…' : 'Verify and continue'}
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setStep('form');
                  setCode('');
                  setError('');
                }}
              >
                Use a different account
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="eyebrow">Checkout account</p>
            <h2 id="auth-title">{mode === 'register' ? 'Create an account to continue.' : 'Welcome back.'}</h2>
            <p className="auth-lead">
              {reason ||
                (mode === 'register'
                  ? 'Your cart is saved. Create an account to confirm the booking and keep track of every update.'
                  : 'Sign in to finish your booking. Your cart will still be here.')}
            </p>

            <div className="auth-tabs" role="tablist" aria-label="Account action">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'register'}
                className={mode === 'register' ? 'active' : ''}
                onClick={() => {
                  setMode('register');
                  setError('');
                }}
              >
                Create account
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'signin'}
                className={mode === 'signin' ? 'active' : ''}
                onClick={() => {
                  setMode('signin');
                  setError('');
                }}
              >
                Sign in
              </button>
            </div>

            <form onSubmit={submit} className="auth-form">
              {mode === 'register' ? (
                <>
                  <label className="shop-field">
                    <span>Full name</span>
                    <input
                      ref={firstField}
                      className="shop-input"
                      autoComplete="name"
                      value={form.name}
                      onChange={update('name')}
                      placeholder="Juan Dela Cruz"
                    />
                  </label>
                  <label className="shop-field">
                    <span>Phone <small>optional</small></span>
                    <input
                      className="shop-input"
                      autoComplete="tel"
                      value={form.phone}
                      onChange={update('phone')}
                      placeholder="0917 000 0000"
                    />
                  </label>
                </>
              ) : null}
              <label className="shop-field">
                <span>Email</span>
                <input
                  ref={mode === 'signin' ? firstField : undefined}
                  className="shop-input"
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={update('email')}
                  placeholder="you@example.com"
                />
              </label>
              <label className="shop-field">
                <span>Password</span>
                <div className="password-wrap">
                  <input
                    className="shop-input"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                    value={form.password}
                    onChange={update('password')}
                    placeholder={mode === 'register' ? 'At least 10 characters' : 'Your password'}
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </label>
              {mode === 'register' ? (
                <ul className="password-rules" aria-label="Password requirements">
                  {PASSWORD_RULES.map(([label, test]) => (
                    <li key={label} className={test(form.password) ? 'met' : ''}>
                      <span aria-hidden="true">{test(form.password) ? '✓' : '·'}</span> {label}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="auth-form-links">
                  <a href="/forgot-password">Forgot your password?</a>
                </div>
              )}
              {error ? <p className="shop-error" role="alert">{error}</p> : null}
              <button className="shop-button shop-button--primary" type="submit" disabled={busy}>
                {busy ? 'Please wait…' : mode === 'register' ? 'Create account and continue' : 'Sign in and continue'}
              </button>
            </form>

            <p className="auth-foot">
              {mode === 'register' ? (
                <>
                  Already have an account?{' '}
                  <button className="text-button" type="button" onClick={() => setMode('signin')}>
                    Sign in
                  </button>
                </>
              ) : (
                <>
                  New to Precious Moments?{' '}
                  <button className="text-button" type="button" onClick={() => setMode('register')}>
                    Create an account
                  </button>
                </>
              )}
            </p>
            <p className="auth-staff">
              Studio owner or branch head? <a href="/login?mode=login">Use the dashboard sign-in</a>.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
