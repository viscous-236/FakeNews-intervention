import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import { copy } from '../../copy';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Field';
import { ErrorState, Notice } from '../../components/ui/Page';
import { AuthShell } from './AuthShell';

export function ForgotPasswordPage(): React.ReactElement {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.includes('@')) return setError(copy.auth.errors.emailInvalid);
    setError(null);
    setBusy(true);
    try {
      await api.post('/api/v1/auth/forgot-password', { email: email.trim() });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err, copy.common.error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title={copy.auth.forgotTitle}
      subtitle={copy.auth.forgotSubtitle}
      footer={
        <Link to="/login" className="text-accent hover:underline">
          {copy.auth.backToSignIn}
        </Link>
      }
    >
      {sent ? (
        <Notice tone="positive">{copy.auth.forgotSent(email.trim())}</Notice>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error ? <ErrorState message={error} compact /> : null}
          <Input
            id="forgot-email"
            label={copy.auth.emailLabel}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Button type="submit" variant="primary" className="w-full" isLoading={busy}>
            {busy ? copy.auth.sending : copy.auth.sendReset}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
