import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Avatar } from '../../components/ui/Avatar';
import { TierBadge, PostLabelBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { copy } from '../../copy';
import { ReviewQueueItem, PaginatedResponse } from '../../types';
import { api } from '../../api/client';
import { Inbox, ArrowRight, Loader2 } from 'lucide-react';

export const AdminQueuePage: React.FC = () => {
  const [items, setItems] = useState<ReviewQueueItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setIsLoading(true);

    api
      .get<PaginatedResponse<ReviewQueueItem>>('/api/v1/admin/queue')
      .then((res) => {
        if (!mounted) return;
        setItems(res.items);
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
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
            <Inbox className="w-5 h-5 text-amber-500" aria-hidden="true" />
            <span>{copy.admin.queue.title}</span>
          </h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            Prioritized by report velocity, automated model confidence, and publisher tier.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="py-16 text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary-600" aria-hidden="true" />
          <p className="mt-3 text-sm text-neutral-500">{copy.loading}</p>
        </div>
      ) : error ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 p-6 text-center text-sm text-red-700 dark:text-red-300"
        >
          {error}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 p-12 text-center text-xs text-neutral-500 bg-white dark:bg-neutral-800">
          {copy.admin.queue.empty}
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div
              key={item.postId}
              className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-4 shadow-sm space-y-3 hover:border-neutral-300 dark:hover:border-neutral-600 transition-colors"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Avatar
                    username={item.post.author.username}
                    displayName={item.post.author.displayName}
                    avatarUrl={item.post.author.avatarUrl}
                    size="sm"
                  />
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                        {item.post.author.displayName}
                      </span>
                      <span className="text-xs text-neutral-500">
                        @{item.post.author.username}
                      </span>
                      <TierBadge tier={item.post.author.tier} />
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                    {copy.admin.queue.priorityBadge(item.priority)}
                  </span>
                  {item.reportCount > 0 && (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300">
                      {copy.admin.queue.reportsCount(item.reportCount)}
                    </span>
                  )}
                  {item.post.label !== 'none' && (
                    <PostLabelBadge label={item.post.label} />
                  )}
                </div>
              </div>

              {/* Body snippet */}
              <p className="text-xs text-neutral-700 dark:text-neutral-300 line-clamp-3 bg-neutral-50 dark:bg-neutral-850 p-2.5 rounded-lg border border-neutral-100 dark:border-neutral-750">
                {item.post.body}
              </p>

              {/* Detection info & link */}
              <div className="flex items-center justify-between pt-1 border-t border-neutral-100 dark:border-neutral-700">
                <div className="text-[11px] text-neutral-500 font-mono flex items-center gap-3">
                  {item.detectionBand && (
                    <span>
                      Band: <strong>{item.detectionBand}</strong>
                    </span>
                  )}
                  {item.pFake && (
                    <span>
                      p_fake: <strong>{Number(item.pFake).toFixed(4)}</strong>
                    </span>
                  )}
                </div>

                <Link to={`/admin/posts/${item.postId}`}>
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />}
                  >
                    {copy.admin.queue.reviewBtn}
                  </Button>
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
