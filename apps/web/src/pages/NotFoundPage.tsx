import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { ShieldAlert, Home } from 'lucide-react';

export const NotFoundPage: React.FC = () => {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center p-6 space-y-4">
      <div className="w-16 h-16 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-400">
        <ShieldAlert className="w-8 h-8" aria-hidden="true" />
      </div>
      <h1 className="text-3xl font-extrabold text-neutral-900 dark:text-neutral-50 tracking-tight">
        404 - Page Not Found
      </h1>
      <p className="text-sm text-neutral-500 max-w-sm">
        The requested resource does not exist or may have been deleted.
      </p>
      <div className="pt-2">
        <Link to="/">
          <Button variant="primary" icon={<Home className="w-4 h-4" aria-hidden="true" />}>
            Return to Feed
          </Button>
        </Link>
      </div>
    </div>
  );
};
