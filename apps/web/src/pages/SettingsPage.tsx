import React, { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  flatten,
  useBlock,
  useBlocks,
  useChangePassword,
  useDeleteAccount,
  useRevokeSession,
  useSessions,
  useUpdateProfile,
  useUploadMedia,
} from '../api/hooks';
import { api, errorMessage } from '../api/client';
import { copy } from '../copy';
import { formatDateTime } from '../lib/format';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { CharCount, Input, Textarea } from '../components/ui/Field';
import { ConfirmDialog } from '../components/ui/Modal';
import { Pill } from '../components/ui/Pill';
import { EmptyState, ErrorState, Notice, PageHeader, Skeleton } from '../components/ui/Page';

/** Settings (TASK-085): two-column rows, one save per panel. */
export function SettingsPage(): React.ReactElement | null {
  const { me, logout } = useAuth();
  if (!me) return null;
  return (
    <div className="mx-auto max-w-sheet">
      <PageHeader title={copy.settings.title} />
      <div className="divide-y divide-border">
        <ProfileSection />
        <EmailSection />
        <PasswordSection />
        <SessionsSection />
        <BlocksSection />
        <ExportSection username={me.username} />
        <DangerSection onDeleted={() => void logout()} />
      </div>
    </div>
  );
}

function Row({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section
      className="grid gap-4 py-8 md:grid-cols-[minmax(0,420px)_minmax(0,1fr)] md:gap-10"
      aria-label={title}
    >
      <div>
        <h2 className="text-section text-ink">{title}</h2>
        <p className="mt-1 text-body text-muted">{description}</p>
      </div>
      <div className="rounded-sheet bg-raised p-4 sm:p-5">{children}</div>
    </section>
  );
}

function ProfileSection(): React.ReactElement {
  const { me } = useAuth();
  const update = useUpdateProfile();
  const upload = useUploadMedia();
  const [displayName, setDisplayName] = useState(me?.displayName ?? '');
  const [bio, setBio] = useState(me?.bio ?? '');
  const [status, setStatus] = useState<{ tone: 'positive' | 'negative'; text: string } | null>(
    null,
  );
  const fileInput = useRef<HTMLInputElement>(null);
  if (!me) return <></>;

  function save(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    update.mutate(
      { displayName: displayName.trim(), bio: bio.trim() },
      {
        onSuccess: () => setStatus({ tone: 'positive', text: copy.settings.profile.saved }),
        onError: (err) =>
          setStatus({ tone: 'negative', text: errorMessage(err, copy.common.error) }),
      },
    );
  }

  async function changePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileInput.current) fileInput.current.value = '';
    if (!file) return;
    setStatus(null);
    try {
      const media = await upload.mutateAsync({ file, kind: 'avatar' });
      await update.mutateAsync({ avatarMediaId: media.id });
      setStatus({ tone: 'positive', text: copy.settings.profile.saved });
    } catch (err) {
      setStatus({ tone: 'negative', text: errorMessage(err, copy.common.error) });
    }
  }

  return (
    <Row title={copy.settings.profile.title} description={copy.settings.profile.description}>
      <form onSubmit={save} className="space-y-4">
        {status ? <Notice tone={status.tone}>{status.text}</Notice> : null}
        <div className="flex items-center gap-4">
          <Avatar
            avatarUrl={me.avatarUrl}
            displayName={me.displayName}
            username={me.username}
            size="lg"
          />
          <div>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => void changePhoto(e)}
            />
            <Button
              variant="secondary"
              size="sm"
              icon={<Upload />}
              onClick={() => fileInput.current?.click()}
              isLoading={upload.isPending}
            >
              {copy.settings.profile.changePhoto}
            </Button>
            <p className="mt-1 text-small text-muted">{copy.settings.profile.photoHint}</p>
          </div>
        </div>
        <Input
          label={copy.settings.profile.displayName}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={50}
          required
        />
        <Textarea
          label={copy.settings.profile.bio}
          hint={copy.settings.profile.bioHint}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={160}
          rows={3}
          trailing={<CharCount value={bio.length} max={160} />}
        />
        <div className="flex justify-end">
          <Button
            type="submit"
            variant="primary"
            isLoading={update.isPending}
            disabled={!displayName.trim()}
          >
            {copy.common.save}
          </Button>
        </div>
      </form>
    </Row>
  );
}

function EmailSection(): React.ReactElement {
  const { me } = useAuth();
  if (!me) return <></>;
  return (
    <Row title={copy.settings.email.title} description={copy.settings.email.description}>
      <p className="text-body text-ink">{me.email}</p>
    </Row>
  );
}

function PasswordSection(): React.ReactElement {
  const change = useChangePassword();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [status, setStatus] = useState<{ tone: 'positive' | 'negative'; text: string } | null>(
    null,
  );
  const lengthError =
    next && (next.length < 10 || next.length > 128) ? copy.auth.errors.passwordLength : null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (lengthError) return;
    setStatus(null);
    change.mutate(
      { currentPassword: current, newPassword: next },
      {
        onSuccess: () => {
          setCurrent('');
          setNext('');
          setStatus({ tone: 'positive', text: copy.settings.password.updated });
        },
        onError: (err) =>
          setStatus({ tone: 'negative', text: errorMessage(err, copy.common.error) }),
      },
    );
  }

  return (
    <Row title={copy.settings.password.title} description={copy.settings.password.description}>
      <form onSubmit={submit} className="space-y-4">
        {status ? <Notice tone={status.tone}>{status.text}</Notice> : null}
        <Input
          label={copy.auth.currentPasswordLabel}
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
        />
        <Input
          label={copy.auth.newPasswordLabel}
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          hint={copy.auth.passwordHint}
          error={lengthError}
          required
        />
        <div className="flex justify-end">
          <Button
            type="submit"
            variant="primary"
            isLoading={change.isPending}
            disabled={!current || !next || Boolean(lengthError)}
          >
            {copy.settings.password.update}
          </Button>
        </div>
      </form>
    </Row>
  );
}

function SessionsSection(): React.ReactElement {
  const sessions = useSessions();
  const revoke = useRevokeSession();
  return (
    <Row title={copy.settings.sessions.title} description={copy.settings.sessions.description}>
      {sessions.isLoading ? (
        <Skeleton lines={3} />
      ) : sessions.isError ? (
        <ErrorState
          message={errorMessage(sessions.error, copy.common.error)}
          onRetry={() => void sessions.refetch()}
          compact
        />
      ) : (
        <ul className="divide-y divide-border">
          {(sessions.data ?? []).map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <p className="truncate text-body text-ink">
                  {s.userAgent
                    ? describeUserAgent(s.userAgent)
                    : copy.settings.sessions.unknownDevice}
                </p>
                <p className="text-small text-muted">
                  {s.ip ?? copy.common.none} ·{' '}
                  {copy.settings.sessions.lastSeen(formatDateTime(s.lastSeenAt))}
                </p>
              </div>
              {s.isCurrent ? (
                <Pill tone="accent">{copy.settings.sessions.current}</Pill>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => revoke.mutate(s.id)}
                  isLoading={revoke.isPending && revoke.variables === s.id}
                >
                  {copy.settings.sessions.revoke}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Row>
  );
}

function describeUserAgent(ua: string): string {
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Mac OS X/.test(ua)
      ? 'macOS'
      : /Android/.test(ua)
        ? 'Android'
        : /iPhone|iPad/.test(ua)
          ? 'iOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return os ? `${browser} on ${os}` : browser;
}

function BlocksSection(): React.ReactElement {
  const blocks = useBlocks();
  const block = useBlock();
  const items = flatten(blocks.data);
  return (
    <Row title={copy.settings.blocks.title} description={copy.settings.blocks.description}>
      {blocks.isLoading ? (
        <Skeleton lines={2} />
      ) : blocks.isError ? (
        <ErrorState
          message={errorMessage(blocks.error, copy.common.error)}
          onRetry={() => void blocks.refetch()}
          compact
        />
      ) : items.length === 0 ? (
        <EmptyState>{copy.settings.blocks.empty}</EmptyState>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((u) => (
            <li
              key={u.id}
              className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="flex min-w-0 items-center gap-3">
                <Avatar
                  avatarUrl={u.avatarUrl}
                  displayName={u.displayName}
                  username={u.username}
                  size="sm"
                />
                <div className="min-w-0">
                  <p className="truncate text-body text-ink">{u.displayName}</p>
                  <p className="truncate text-small text-muted">@{u.username}</p>
                </div>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => block.mutate({ username: u.username, block: false })}
                isLoading={block.isPending && block.variables?.username === u.username}
              >
                {copy.settings.blocks.unblock}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Row>
  );
}

function ExportSection({ username }: { username: string }): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function download() {
    setBusy(true);
    setError(null);
    try {
      const data = await api.get<unknown>('/api/v1/users/me/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `export-${username}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(errorMessage(err, copy.common.error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Row title={copy.settings.export.title} description={copy.settings.export.description}>
      {error ? (
        <div className="mb-3">
          <ErrorState message={error} compact />
        </div>
      ) : null}
      <Button
        variant="secondary"
        icon={<Download />}
        onClick={() => void download()}
        isLoading={busy}
      >
        {copy.settings.export.download}
      </Button>
    </Row>
  );
}

function DangerSection({ onDeleted }: { onDeleted: () => void }): React.ReactElement {
  const del = useDeleteAccount();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Row title={copy.settings.danger.title} description={copy.settings.danger.description}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setConfirm(true);
        }}
      >
        {error ? <ErrorState message={error} compact /> : null}
        <Input
          label={copy.settings.danger.confirmPassword}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <div className="flex justify-end">
          <Button type="submit" variant="danger" disabled={!password}>
            {copy.settings.danger.delete}
          </Button>
        </div>
      </form>
      <ConfirmDialog
        isOpen={confirm}
        onClose={() => setConfirm(false)}
        title={copy.settings.danger.confirmTitle}
        body={copy.settings.danger.confirmBody}
        confirmLabel={copy.settings.danger.delete}
        danger
        isLoading={del.isPending}
        onConfirm={() =>
          del.mutate(password, {
            onSuccess: onDeleted,
            onError: (err) => {
              setConfirm(false);
              setError(errorMessage(err, copy.common.error));
            },
          })
        }
      />
    </Row>
  );
}
