import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import { copy } from '../../copy';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Field';
import { ErrorState, Notice } from '../../components/ui/Page';
import { AuthShell } from './AuthShell';

export function ResetPasswordPage(): React.ReactElement {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const tokenFromUrl = params.get('token') ?? '';
  const [token, setToken] = useState(tokenFromUrl);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim()) return setError(copy.auth.errors.tokenRequired);
    if (password.length < 10 || password.length > 128)
      return setError(copy.auth.errors.passwordLength);
    if (password !== confirm) return setError(copy.auth.errors.passwordMismatch);
    setError(null);
    setBusy(true);
    try {
      await api.post('/api/v1/auth/reset-password', { token: token.trim(), password });
      setDone(true);
      setTimeout(() => navigate('/login'), 2000);
    } catch (err) {
      setError(errorMessage(err, copy.common.error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title={copy.auth.resetTitle}
      footer={
        <Link to="/login" className="text-accent hover:underline">
          {copy.auth.backToSignIn}
        </Link>
      }
    >
      {done ? (
        <Notice tone="positive">{copy.auth.resetDone}</Notice>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error ? <ErrorState message={error} compact /> : null}
          {!tokenFromUrl ? (
            <Input
              id="reset-token"
              label={copy.auth.tokenLabel}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
            />
          ) : null}
          <Input
            id="reset-password"
            label={copy.auth.newPasswordLabel}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint={copy.auth.passwordHint}
            required
          />
          <Input
            id="reset-confirm"
            label={copy.auth.confirmPasswordLabel}
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
          <Button type="submit" variant="primary" className="w-full" isLoading={busy}>
            {copy.auth.updatePassword}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
