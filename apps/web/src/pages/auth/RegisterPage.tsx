import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { copy } from '../../copy';
import { ShieldAlert, UserPlus } from 'lucide-react';

export const RegisterPage: React.FC = () => {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Frontend validation matching shared Zod schema rules
    if (!email.includes('@')) {
      setError('Please provide a valid email address.');
      return;
    }
    if (username.length < 3 || username.length > 30 || !/^[a-zA-Z0-9_]+$/.test(username)) {
      setError('Username must be 3-30 characters and alphanumeric.');
      return;
    }
    if (displayName.trim().length < 1 || displayName.length > 50) {
      setError('Display name must be between 1 and 50 characters.');
      return;
    }
    if (password.length < 10 || password.length > 128) {
      setError('Password must be at least 10 characters long.');
      return;
    }

    try {
      setIsLoading(true);
      await register({
        email: email.trim(),
        username: username.trim(),
        displayName: displayName.trim(),
        password,
      });
      navigate('/');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : copy.error;
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center text-primary-600 dark:text-primary-400">
          <ShieldAlert className="w-12 h-12" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-center text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
          {copy.auth.signUpTitle}
        </h1>
        <p className="mt-2 text-center text-sm text-neutral-600 dark:text-neutral-400">
          {copy.auth.signUpSubtitle}
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white dark:bg-neutral-800 py-8 px-4 shadow-sm border border-neutral-200 dark:border-neutral-700 sm:rounded-xl sm:px-10">
          {error && (
            <div
              role="alert"
              className="mb-4 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 p-3 text-sm text-red-700 dark:text-red-300"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              id="register-email"
              label={copy.auth.emailLabel}
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="alice@example.com"
            />

            <Input
              id="register-username"
              label={copy.auth.usernameLabel}
              type="text"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="alice_journal"
              helperText="3-30 alphanumeric characters or underscores"
            />

            <Input
              id="register-displayName"
              label={copy.auth.displayNameLabel}
              type="text"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Alice Walker"
            />

            <Input
              id="register-password"
              label={copy.auth.passwordLabel}
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              helperText="Minimum 10 characters (SEC-023)"
            />

            <Button
              type="submit"
              variant="primary"
              className="w-full mt-2"
              isLoading={isLoading}
              icon={<UserPlus className="w-4 h-4" aria-hidden="true" />}
            >
              {isLoading ? copy.auth.signingUp : copy.auth.signUpBtn}
            </Button>
          </form>

          <div className="mt-6 text-center border-t border-neutral-100 dark:border-neutral-700 pt-4">
            <Link
              to="/login"
              className="text-sm font-medium text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200"
            >
              {copy.auth.haveAccount}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
