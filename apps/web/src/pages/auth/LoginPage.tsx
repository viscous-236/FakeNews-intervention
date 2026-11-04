import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { copy } from '../../copy';
import { errorMessage } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Field';
import { ErrorState } from '../../components/ui/Page';
import { AuthShell } from './AuthShell';

export function LoginPage(): React.ReactElement {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/';
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!identifier.trim()) return setError(copy.auth.errors.identifierRequired);
    if (!password) return setError(copy.auth.errors.passwordRequired);
    setError(null);
    setBusy(true);
    try {
      await login(identifier.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(errorMessage(err, copy.common.error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title={copy.auth.signInTitle}
      subtitle={copy.auth.signInSubtitle}
      footer={
        <>
          {copy.auth.needAccount}{' '}
          <Link to="/register" className="text-accent hover:underline">
            {copy.auth.signUp}
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error ? <ErrorState message={error} compact /> : null}
        <Input
          id="login-identifier"
          label={copy.auth.identifierLabel}
          autoComplete="username"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          required
        />
        <Input
          id="login-password"
          label={copy.auth.passwordLabel}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          trailing={
            <Link to="/forgot-password" className="text-small text-accent hover:underline">
              {copy.auth.forgotLink}
            </Link>
          }
        />
        <Button type="submit" variant="primary" className="w-full" isLoading={busy}>
          {busy ? copy.auth.signingIn : copy.auth.signIn}
        </Button>
      </form>
    </AuthShell>
  );
}
