import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { copy } from '../../copy';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl';
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  maxWidth,
  size,
}: ModalProps): React.ReactElement | null {
  const modalRef = useRef<HTMLDivElement>(null);
  const effectiveWidth = size || maxWidth || 'md';

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    }
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.body.style.overflow = 'unset';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const maxWidthStyles = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-neutral-900/50 backdrop-blur-xs transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Dialog Card */}
      <div
        ref={modalRef}
        className={`relative w-full ${maxWidthStyles[effectiveWidth]} rounded-2xl bg-white p-6 shadow-xl ring-1 ring-neutral-900/10 dark:bg-neutral-900 dark:ring-neutral-800 transition-all z-10`}
      >
        <div className="flex items-start justify-between pb-3">
          <div>
            <h3 id="modal-title" className="text-lg font-bold text-neutral-900 dark:text-neutral-100">
              {title}
            </h3>
            {description && (
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={copy.close}
            className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300 min-h-[44px] min-w-[44px] inline-flex items-center justify-center focus:outline-none"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}
