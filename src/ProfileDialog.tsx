import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from './placeholderIcons';

export default function ProfileDialog({
  title,
  closeLabel,
  onClose,
  children,
}: {
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const opener = document.activeElement as HTMLElement | null;
    dialog.current
      ?.querySelector<HTMLElement>('input, select, textarea')
      ?.focus();
    return () => opener?.focus?.();
  }, []);
  return (
    <div className="week-modal-backdrop" role="presentation" onClick={onClose}>
      <section
        ref={dialog}
        className="week-modal profile-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="panel-heading">
          <h2>{title}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label={closeLabel}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
