import React, { useState } from 'react';
import { Flag } from 'lucide-react';
import type { ReportReason } from '../../types';
import { copy } from '../../copy';
import { errorMessage } from '../../api/client';
import { useReportPost } from '../../api/hooks';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { CharCount, Select, Textarea } from '../ui/Field';
import { ErrorState, Notice } from '../ui/Page';

const REASONS: ReportReason[] = ['false_information', 'misleading', 'spam', 'harassment', 'other'];

export function ReportDialog({
  postId,
  isOpen,
  onClose,
}: {
  postId: string;
  isOpen: boolean;
  onClose: () => void;
}): React.ReactElement | null {
  const [reason, setReason] = useState<ReportReason>('false_information');
  const [details, setDetails] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const report = useReportPost();

  function close() {
    setDone(false);
    setDetails('');
    setError(null);
    onClose();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    report.mutate(
      { postId, reason, details: details.trim() || undefined },
      {
        onSuccess: () => setDone(true),
        onError: (err) => setError(errorMessage(err, copy.common.error)),
      },
    );
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={copy.reportDialog.title}
      description={copy.reportDialog.description}
    >
      {done ? (
        <div className="space-y-4">
          <Notice tone="positive">{copy.reportDialog.success}</Notice>
          <div className="flex justify-end">
            <Button variant="primary" onClick={close}>
              {copy.common.close}
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error ? <ErrorState message={error} compact /> : null}
          <Select
            label={copy.reportDialog.reasonLabel}
            value={reason}
            onChange={(e) => setReason(e.target.value as ReportReason)}
          >
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {copy.reportDialog.reasons[r]}
              </option>
            ))}
          </Select>
          <Textarea
            label={copy.reportDialog.detailsLabel}
            placeholder={copy.reportDialog.detailsPlaceholder}
            rows={3}
            maxLength={500}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            trailing={<CharCount value={details.length} max={500} />}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close} disabled={report.isPending}>
              {copy.common.cancel}
            </Button>
            <Button type="submit" variant="primary" isLoading={report.isPending} icon={<Flag />}>
              {report.isPending ? copy.reportDialog.submitting : copy.reportDialog.submit}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
