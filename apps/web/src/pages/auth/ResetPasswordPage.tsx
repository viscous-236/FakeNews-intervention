import React, { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { copy } from '../../copy';
import { KeyRound, CheckCircle2 } from 'lucide-react';

export const ResetPasswordPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const tokenFromUrl = searchParams.get('token') || '';

  const [token, setToken] = useState(tokenFromUrl);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!token.trim()) {
      setError('Password reset token is required.');
      return;
    }
    if (password.length < 10 || password.length > 128) {
      setError('New password must be between 10 and 128 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    try {
      setIsLoading(true);
      await api.post('/api/v1/auth/reset-password', {
        token: token.trim(),
        password,
      });
      setSuccess(true);
      setTimeout(() => navigate('/login'), 2500);
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
          <KeyRound className="w-12 h-12" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-center text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
          {copy.auth.resetPasswordTitle}
        </h1>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white dark:bg-neutral-800 py-8 px-4 shadow-sm border border-neutral-200 dark:border-neutral-700 sm:rounded-xl sm:px-10">
          {success ? (
            <div className="text-center space-y-4">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-950/50 text-green-600 dark:text-green-400">
                <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
              </div>
              <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
                Password updated successfully. Redirecting to sign in…
              </p>
              <div className="pt-2">
                <Link to="/login">
                  <Button variant="primary" className="w-full">
                    Sign In Now
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            <>
              {error && (
                <div
                  role="alert"
                  className="mb-4 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 p-3 text-sm text-red-700 dark:text-red-300"
                >
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                {!tokenFromUrl && (
                  <Input
                    id="reset-token"
                    label={copy.auth.tokenLabel}
                    type="text"
                    required
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="Enter security token from email"
                  />
                )}

                <Input
                  id="reset-password"
                  label={copy.auth.newPasswordLabel}
                  type="password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  helperText="Minimum 10 characters"
                />

                <Input
                  id="reset-confirm-password"
                  label="Confirm New Password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />

                <Button
                  type="submit"
                  variant="primary"
                  className="w-full mt-2"
                  isLoading={isLoading}
                >
                  {copy.auth.resetBtn}
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
