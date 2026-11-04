import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Avatar } from '../../components/ui/Avatar';
import { TierBadge, PostLabelBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { copy } from '../../copy';
import { Post, AssessmentVerdict, ReportReason } from '../../types';
import { api } from '../../api/client';
import {
  Cpu,
  Flag,
  Scale,
  CheckCircle2,
  XCircle,
  HelpCircle,
  AlertTriangle,
  ArrowLeft,
  Loader2,
} from 'lucide-react';

interface ReviewPostDetail {
  post: Post;
  reports: Array<{
    id: string;
    reporter: { id: string; username: string };
    reason: ReportReason;
    details: string | null;
    createdAt: string;
  }>;
  interactors: {
    resharersCount: number;
    likersCount: number;
    reportersCount: number;
  };
  hasConflictOfInterest: boolean;
}

export const AdminReviewWorkspacePage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [data, setData] = useState<ReviewPostDetail | null>(null);
  const [verdict, setVerdict] = useState<AssessmentVerdict>('fake');
  const [rationale, setRationale] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    if (!id) return;

    setIsLoading(true);
    setError(null);

    api
      .get<ReviewPostDetail>(`/api/v1/admin/posts/${id}`)
      .then((res) => {
        if (!mounted) return;
        setData(res);
      })
      .catch((err: unknown) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : copy.error);
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [id]);

  const handleSubmitVerdict = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !data || data.hasConflictOfInterest || isSubmitting) return;

    if (rationale.trim().length < 10) {
      setError('Fact-checking rationale must be at least 10 characters.');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      await api.post(`/api/v1/admin/posts/${id}/assessments`, {
        verdict,
        rationale: rationale.trim(),
      });
      navigate('/admin/queue');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : copy.error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="py-20 text-center">
        <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary-600" aria-hidden="true" />
        <p className="mt-3 text-sm text-neutral-500">{copy.loading}</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 p-6 text-center text-sm text-red-700 dark:text-red-300"
      >
        {error || copy.error}
      </div>
    );
  }

  const { post, reports, interactors, hasConflictOfInterest } = data;
  const detection = post.adminView?.detection;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Top back navigation */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate('/admin/queue')}
          className="p-2 text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center focus:outline-none"
          aria-label="Back to queue"
        >
          <ArrowLeft className="w-5 h-5" aria-hidden="true" />
        </button>
        <h2 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">
          {copy.admin.workspace.title}
        </h2>
      </div>

      {/* Conflict of Interest Alert */}
      {hasConflictOfInterest && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 p-4 text-xs text-red-800 dark:text-red-200 flex items-start gap-2.5 font-medium"
        >
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{copy.admin.workspace.conflictError}</span>
        </div>
      )}

      {/* Post Context Card */}
      <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Avatar
              username={post.author.username}
              displayName={post.author.displayName}
              avatarUrl={post.author.avatarUrl}
              size="md"
            />
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                  {post.author.displayName}
                </span>
                <span className="text-xs text-neutral-500">
                  @{post.author.username}
                </span>
                <TierBadge tier={post.author.tier} />
              </div>
              <time className="text-[11px] text-neutral-400">
                Posted {new Date(post.createdAt).toLocaleString()}
              </time>
            </div>
          </div>

          <PostLabelBadge label={post.label} underAppeal={post.underAppeal} />
        </div>

        <p className="text-sm text-neutral-800 dark:text-neutral-200 bg-neutral-50 dark:bg-neutral-850 p-3.5 rounded-lg border border-neutral-200 dark:border-neutral-700 whitespace-pre-line leading-relaxed">
          {post.body}
        </p>

        {post.sourceUrl && (
          <div className="text-xs text-neutral-500">
            <strong>Source URL:</strong>{' '}
            <a
              href={post.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary-600 hover:underline"
            >
              {post.sourceUrl}
            </a>
          </div>
        )}
      </div>

      {/* Model Output & User Reports Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* RoBERTa Model Output */}
        <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-4 shadow-sm space-y-3">
          <h3 className="text-xs font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-1.5 uppercase tracking-wider">
            <Cpu className="w-4 h-4 text-primary-600" aria-hidden="true" />
            <span>{copy.admin.workspace.modelOutput}</span>
          </h3>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b border-neutral-100 dark:border-neutral-700">
              <span className="text-neutral-500">{copy.admin.workspace.bandLabel}</span>
              <span className="font-semibold">{detection?.band || 'None'}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-neutral-100 dark:border-neutral-700">
              <span className="text-neutral-500">{copy.admin.workspace.pFakeLabel}</span>
              <span className="font-mono font-bold text-primary-600">
                {detection?.pFake ? Number(detection.pFake).toFixed(4) : 'N/A'}
              </span>
            </div>
            <div className="flex justify-between py-1 text-neutral-400 text-[11px]">
              <span>Model ID</span>
              <span>{detection?.modelName} ({detection?.modelVersion})</span>
            </div>
          </div>
        </div>

        {/* User Reports */}
        <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-4 shadow-sm space-y-3">
          <h3 className="text-xs font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-1.5 uppercase tracking-wider">
            <Flag className="w-4 h-4 text-red-500" aria-hidden="true" />
            <span>{copy.admin.workspace.reportsSection} ({reports.length})</span>
          </h3>

          {reports.length === 0 ? (
            <p className="text-xs text-neutral-400 italic">No user reports submitted.</p>
          ) : (
            <div className="divide-y divide-neutral-100 dark:divide-neutral-700 max-h-48 overflow-y-auto space-y-2 text-xs">
              {reports.map((r) => (
                <div key={r.id} className="pt-2">
                  <div className="flex justify-between font-medium">
                    <span>@{r.reporter.username}</span>
                    <span className="text-red-600">{r.reason}</span>
                  </div>
                  {r.details && (
                    <p className="text-[11px] text-neutral-500 mt-0.5">{r.details}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Decision & Binding Consequences Form */}
      <form
        onSubmit={handleSubmitVerdict}
        className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-5 shadow-sm space-y-4"
      >
        <div className="flex items-center gap-2 pb-2 border-b border-neutral-100 dark:border-neutral-700">
          <Scale className="w-5 h-5 text-primary-600 dark:text-primary-400" aria-hidden="true" />
          <h3 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
            {copy.admin.workspace.decisionSection}
          </h3>
        </div>

        {/* Verdict Radio options */}
        <div>
          <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-2">
            {copy.admin.workspace.verdictLabel}
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button
              type="button"
              onClick={() => setVerdict('fake')}
              className={`p-3 rounded-lg border text-left transition-colors flex items-center gap-2.5 ${
                verdict === 'fake'
                  ? 'border-red-500 bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-200'
                  : 'border-neutral-200 dark:border-neutral-700 hover:border-neutral-300'
              }`}
            >
              <XCircle className="w-4 h-4 text-red-600 shrink-0" aria-hidden="true" />
              <div>
                <span className="font-bold text-xs block">Fake / False Claim</span>
                <span className="text-[10px] text-neutral-500">Penalize misinformation</span>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setVerdict('real')}
              className={`p-3 rounded-lg border text-left transition-colors flex items-center gap-2.5 ${
                verdict === 'real'
                  ? 'border-green-500 bg-green-50 dark:bg-green-950/30 text-green-800 dark:text-green-200'
                  : 'border-neutral-200 dark:border-neutral-700 hover:border-neutral-300'
              }`}
            >
              <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" aria-hidden="true" />
              <div>
                <span className="font-bold text-xs block">Real / Verified</span>
                <span className="text-[10px] text-neutral-500">Award responsible sharing</span>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setVerdict('unverifiable')}
              className={`p-3 rounded-lg border text-left transition-colors flex items-center gap-2.5 ${
                verdict === 'unverifiable'
                  ? 'border-neutral-500 bg-neutral-100 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200'
                  : 'border-neutral-200 dark:border-neutral-700 hover:border-neutral-300'
              }`}
            >
              <HelpCircle className="w-4 h-4 text-neutral-500 shrink-0" aria-hidden="true" />
              <div>
                <span className="font-bold text-xs block">Unverifiable</span>
                <span className="text-[10px] text-neutral-500">Zero reputation change</span>
              </div>
            </button>
          </div>
        </div>

        {/* Binding Consequences Preview Box (Section 1.8) */}
        <div className="rounded-lg bg-neutral-50 dark:bg-neutral-850 border border-neutral-200 dark:border-neutral-700 p-3.5 space-y-1.5 text-xs">
          <span className="font-bold text-neutral-800 dark:text-neutral-200 block">
            {copy.admin.workspace.consequenceHeader}
          </span>
          <p className="font-mono text-neutral-700 dark:text-neutral-300">
            {verdict === 'fake'
              ? copy.admin.workspace.consequenceFake(
                  interactors.resharersCount,
                  interactors.likersCount,
                  interactors.reportersCount
                )
              : verdict === 'real'
              ? copy.admin.workspace.consequenceReal(interactors.resharersCount)
              : copy.admin.workspace.consequenceUnverifiable}
          </p>
        </div>

        {/* Rationale Input */}
        <div>
          <label
            htmlFor="assessment-rationale"
            className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1"
          >
            {copy.admin.workspace.rationaleLabel}
          </label>
          <textarea
            id="assessment-rationale"
            rows={3}
            required
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            placeholder="Document evidentiary sources, citations, or fact-checking justification…"
            className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2 text-xs text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => navigate('/admin/queue')}
            disabled={isSubmitting}
          >
            {copy.cancel}
          </Button>

          <Button
            type="submit"
            variant="primary"
            disabled={hasConflictOfInterest || rationale.trim().length < 10 || isSubmitting}
            isLoading={isSubmitting}
          >
            {isSubmitting ? copy.admin.workspace.submitting : copy.admin.workspace.submitVerdict}
          </Button>
        </div>
      </form>
    </div>
  );
};
