import React from 'react';
import { useMe } from '../../context/AuthContext';
import { copy } from '../../copy';
import { Notice } from '../ui/Page';

/** Shown to members who cannot act: a suspended account. */
export function AccountStatusBanner(): React.ReactElement | null {
  const { user } = useMe();
  if (!user || user.status !== 'suspended') return null;
  return (
    <div className="mb-5">
      <Notice tone="negative">{copy.accountBanner.suspended}</Notice>
    </div>
  );
}
