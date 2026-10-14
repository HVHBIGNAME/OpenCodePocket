import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ArrowUpRight, Check, Copy, LoaderCircle, X } from 'lucide-react';
import clsx from 'clsx';
import { dragFeedback, useSwipe } from '../lib/gestures';

export function Button({
  variant = 'primary',
  busy = false,
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  busy?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={clsx('button', `button-${variant}`, className)}
    >
      {busy && <LoaderCircle size={17} className="spin" />} {children}
    </button>
  );
}

export function IconButton({
  label,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...props}
      type={props.type ?? 'button'}
      title={label}
      aria-label={label}
      className={clsx('icon-button', props.className)}
    >
      {children}
    </button>
  );
}

export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closing = useRef(false);
  const close = () => {
    const dialog = ref.current;
    if (!dialog || closing.current) return;
    closing.current = true;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onClose();
      return;
    }
    const animation = dialog.animate(
      [{ transform: dialog.style.transform || 'none' }, { transform: 'translateY(110%)', opacity: 0 }],
      { duration: 160, easing: 'ease-in', fill: 'forwards' },
    );
    void animation.finished
      .then(() => {
        if (dialog.isConnected) onClose();
      })
      .catch(() => undefined);
  };
  useSwipe(ref, {
    axis: 'y',
    settleOnCommit: false,
    canStart: (target) => {
      const allowed =
        Boolean(target.closest('.modal-handle, .modal-header')) &&
        !target.closest('input, textarea, select, .modal-header button') &&
        !closing.current &&
        (ref.current?.scrollTop ?? 0) <= 1;
      if (allowed && ref.current) ref.current.style.animation = 'none';
      return allowed;
    },
    onProgress: (distance) => dragFeedback(ref.current, 'y', Math.max(0, distance)),
    onSwipe: (direction) => {
      if (direction > 0) close();
      else dragFeedback(ref.current, 'y', 0);
    },
  });
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={clsx('modal', wide && 'modal-wide')}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          close();
        }
      }}
    >
      <div className="modal-inner">
        <button type="button" className="modal-handle" aria-label="Закрыть панель" onClick={close}>
          <span />
        </button>
        <div className="modal-header">
          <div>
            <h2>{title}</h2>
            {subtitle && <p className="muted">{subtitle}</p>}
          </div>
          <IconButton label="Закрыть" onClick={close}>
            <X size={21} />
          </IconButton>
        </div>
        {children}
      </div>
    </dialog>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function CopyButton({ text, label = 'Копировать' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <IconButton
      label={error ? 'Буфер обмена недоступен' : copied ? 'Скопировано' : label}
      onClick={() => {
        void navigator.clipboard
          .writeText(text)
          .then(() => {
            setCopied(true);
            setError(false);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 2000);
          })
          .catch(() => setError(true));
      }}
    >
      {copied ? <Check size={16} /> : error ? <X size={16} /> : <Copy size={16} />}
    </IconButton>
  );
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="text-link" href={href} target="_blank" rel="noreferrer">
      {children}
      <ArrowUpRight size={15} />
    </a>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label className="toggle-row">
      <span>
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="toggle-track" aria-hidden="true" />
    </label>
  );
}
