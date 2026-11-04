import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { copy } from '../../copy';
import { errorMessage } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Field';
import { ErrorState } from '../../components/ui/Page';
import { AuthShell } from './AuthShell';

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export function RegisterPage(): React.ReactElement {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const errors = {
    email: !email.includes('@') ? copy.auth.errors.emailInvalid : null,
    username: !USERNAME_RE.test(username) ? copy.auth.errors.usernameInvalid : null,
    displayName:
      displayName.trim().length < 1 || displayName.trim().length > 50
        ? copy.auth.errors.displayNameInvalid
        : null,
    password:
      password.length < 10 || password.length > 128 ? copy.auth.errors.passwordLength : null,
  };
  const valid = !Object.values(errors).some(Boolean);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    setError(null);
    setBusy(true);
    try {
      await register({
        email: email.trim(),
        username: username.trim(),
        displayName: displayName.trim(),
        password,
      });
      navigate('/');
    } catch (err) {
      setError(errorMessage(err, copy.common.error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title={copy.auth.signUpTitle}
      subtitle={copy.auth.signUpSubtitle}
      footer={
        <>
          {copy.auth.haveAccount}{' '}
          <Link to="/login" className="text-accent hover:underline">
            {copy.auth.signIn}
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error ? <ErrorState message={error} compact /> : null}
        <Input
          id="register-email"
          label={copy.auth.emailLabel}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={touched ? errors.email : null}
          required
        />
        <Input
          id="register-username"
          label={copy.auth.usernameLabel}
          autoComplete="username"
          autoCapitalize="none"
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase())}
          hint={copy.auth.usernameHint}
          error={touched ? errors.username : null}
          required
        />
        <Input
          id="register-displayName"
          label={copy.auth.displayNameLabel}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          error={touched ? errors.displayName : null}
          maxLength={50}
          required
        />
        <Input
          id="register-password"
          label={copy.auth.passwordLabel}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint={copy.auth.passwordHint}
          error={touched ? errors.password : null}
          required
        />
        <Button type="submit" variant="primary" className="w-full" isLoading={busy}>
          {busy ? copy.auth.signingUp : copy.auth.signUp}
        </Button>
      </form>
    </AuthShell>
  );
}
