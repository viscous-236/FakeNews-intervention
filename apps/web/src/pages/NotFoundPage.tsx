import React from 'react';
import { Link } from 'react-router-dom';
import { copy } from '../copy';
import { Button } from '../components/ui/Button';

export function NotFoundPage(): React.ReactElement {
  return (
    <div className="mx-auto max-w-md py-16">
      <h1 className="text-title text-ink">{copy.notFound.title}</h1>
      <p className="mt-2 text-body text-muted">{copy.notFound.body}</p>
      <Link to="/" className="mt-6 inline-block">
        <Button variant="primary">{copy.notFound.home}</Button>
      </Link>
    </div>
  );
}
