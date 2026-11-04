import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { copy } from '../../copy';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

export const VerifyEmailPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const tokenFromUrl = searchParams.get('token') || '';

  const [token, setToken] = useState(tokenFromUrl);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>(
    tokenFromUrl ? 'loading' : 'idle'
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (tokenFromUrl) {
      void verifyToken(tokenFromUrl);
    }
  }, [tokenFromUrl]);

  const verifyToken = async (tok: string) => {
    setStatus('loading');
    setErrorMessage(null);
    try {
      await api.post('/api/v1/auth/verify-email', { token: tok.trim() });
      setStatus('success');
    } catch (err: unknown) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : copy.error);
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (token.trim()) {
      void verifyToken(token);
    }
  };

  return (
    <div className="min-h-[80vh] flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h1 className="text-center text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
          {copy.auth.verifyEmailTitle}
        </h1>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white dark:bg-neutral-800 py-8 px-4 shadow-sm border border-neutral-200 dark:border-neutral-700 sm:rounded-xl sm:px-10">
          {status === 'loading' && (
            <div className="text-center py-6">
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary-600 dark:text-primary-400" aria-hidden="true" />
              <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-400">
                Verifying your email token…
              </p>
            </div>
          )}

          {status === 'success' && (
            <div className="text-center space-y-4">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-950/50 text-green-600 dark:text-green-400">
                <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
              </div>
              <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
                Email address confirmed! Your account now has verified contributor standing.
              </p>
              <div className="pt-2">
                <Link to="/">
                  <Button variant="primary" className="w-full">
                    Go to Feed
                  </Button>
                </Link>
              </div>
            </div>
          )}

          {status === 'error' && (
            <div className="space-y-4">
              <div
                role="alert"
                className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 p-3 text-sm text-red-700 dark:text-red-300 flex items-start gap-2"
              >
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
                <div>{errorMessage}</div>
              </div>

              <form onSubmit={handleManualSubmit} className="space-y-4 pt-2">
                <Input
                  id="manual-token"
                  label={copy.auth.tokenLabel}
                  type="text"
                  required
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Enter security token from email"
                />
                <Button type="submit" variant="primary" className="w-full">
                  Retry Verification
                </Button>
              </form>
            </div>
          )}

          {status === 'idle' && (
            <form onSubmit={handleManualSubmit} className="space-y-4">
              <Input
                id="manual-token-idle"
                label={copy.auth.tokenLabel}
                type="text"
                required
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste verification token"
              />
              <Button type="submit" variant="primary" className="w-full">
                Verify Email
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
