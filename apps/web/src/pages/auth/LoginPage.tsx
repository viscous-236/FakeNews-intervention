import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { copy } from '../../copy';
import { ShieldCheck, LogIn } from 'lucide-react';

export const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/';

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!identifier.trim()) {
      setError('Username or email is required.');
      return;
    }
    if (!password) {
      setError('Password is required.');
      return;
    }

    try {
      setIsLoading(true);
      await login(identifier.trim(), password);
      navigate(from, { replace: true });
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
          <ShieldCheck className="w-12 h-12" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-center text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
          {copy.auth.signInTitle}
        </h1>
        <p className="mt-2 text-center text-sm text-neutral-600 dark:text-neutral-400">
          {copy.auth.signInSubtitle}
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
              id="login-identifier"
              label={copy.auth.usernameLabel + ' or ' + copy.auth.emailLabel}
              type="text"
              autoComplete="username"
              required
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="alice or alice@example.com"
            />

            <Input
              id="login-password"
              label={copy.auth.passwordLabel}
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />

            <div className="flex items-center justify-end">
              <Link
                to="/forgot-password"
                className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 focus:outline-none focus:underline"
              >
                {copy.auth.forgotPasswordLink}
              </Link>
            </div>

            <Button
              type="submit"
              variant="primary"
              className="w-full mt-2"
              isLoading={isLoading}
              icon={<LogIn className="w-4 h-4" aria-hidden="true" />}
            >
              {isLoading ? copy.auth.signingIn : copy.auth.signInBtn}
            </Button>
          </form>

          <div className="mt-6 text-center border-t border-neutral-100 dark:border-neutral-700 pt-4">
            <Link
              to="/register"
              className="text-sm font-medium text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200"
            >
              {copy.auth.needAccount}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
