import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { copy } from '../../copy';
import { KeyRound, Mail, ArrowLeft } from 'lucide-react';

export const ForgotPasswordPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !email.includes('@')) {
      setError('Please provide a valid email address.');
      return;
    }

    try {
      setIsLoading(true);
      // Endpoint returns 204 always (SEC-009)
      await api.post('/api/v1/auth/forgot-password', { email: email.trim() });
      setSent(true);
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
          {copy.auth.forgotPasswordTitle}
        </h1>
        <p className="mt-2 text-center text-sm text-neutral-600 dark:text-neutral-400">
          {copy.auth.forgotPasswordSubtitle}
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white dark:bg-neutral-800 py-8 px-4 shadow-sm border border-neutral-200 dark:border-neutral-700 sm:rounded-xl sm:px-10">
          {sent ? (
            <div className="text-center space-y-4">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-950/50 text-green-600 dark:text-green-400">
                <Mail className="h-6 w-6" aria-hidden="true" />
              </div>
              <p className="text-sm text-neutral-700 dark:text-neutral-300">
                If an account exists for <span className="font-medium text-neutral-900 dark:text-neutral-100">{email}</span>, a secure password reset link has been dispatched.
              </p>
              <div className="pt-4">
                <Link to="/login">
                  <Button variant="outline" className="w-full">
                    Return to Sign In
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
                <Input
                  id="forgot-email"
                  label={copy.auth.emailLabel}
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="alice@example.com"
                />

                <Button
                  type="submit"
                  variant="primary"
                  className="w-full mt-2"
                  isLoading={isLoading}
                  icon={<Mail className="w-4 h-4" aria-hidden="true" />}
                >
                  {isLoading ? copy.auth.sending : copy.auth.sendResetBtn}
                </Button>
              </form>

              <div className="mt-6 text-center border-t border-neutral-100 dark:border-neutral-700 pt-4">
                <Link
                  to="/login"
                  className="inline-flex items-center text-sm font-medium text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200"
                >
                  <ArrowLeft className="w-4 h-4 mr-1" aria-hidden="true" />
                  {copy.auth.haveAccount}
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
