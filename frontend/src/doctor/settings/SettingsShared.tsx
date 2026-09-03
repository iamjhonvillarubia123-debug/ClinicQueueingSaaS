import { useEffect, useRef, useState, type ReactNode } from 'react';
import { apiRequest } from '../../api/client';
import { OperationsIcon, type OperationsIconName } from '../OperationsIcon';

export function useSettingsData<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    apiRequest<T>(path)
      .then((value) => {
        if (current) {
          setData(value);
          setError('');
        }
      })
      .catch(() => {
        if (current)
          setError('Unable to load this information. Please try again.');
      });
    return () => {
      current = false;
    };
  }, [path, revision]);
  return {
    data,
    setData,
    error,
    reload: () => setRevision((value) => value + 1),
  };
}

export function Card({
  title,
  description,
  icon = 'info',
  children,
  tone = '',
}: {
  title: string;
  description?: string;
  icon?: OperationsIconName;
  children: ReactNode;
  tone?: string;
}) {
  return (
    <section className={`ds-card ${tone}`}>
      <header>
        <span className="ds-icon">
          <OperationsIcon name={icon} />
        </span>
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

export function Note({
  children,
  warning = false,
}: {
  children: ReactNode;
  warning?: boolean;
}) {
  return (
    <div className={`ds-note${warning ? ' ds-warning' : ''}`}>
      <OperationsIcon name="info" size={18} />
      <div>{children}</div>
    </div>
  );
}

export function Unconnected({ reason }: { reason: string }) {
  return (
    <Note warning>
      <strong>Not connected yet</strong>
      <p>{reason} No changes will be saved.</p>
    </Note>
  );
}

export function Checklist({ items }: { items: string[] }) {
  return (
    <ul className="ds-checklist">
      {items.map((item) => (
        <li key={item}>
          <OperationsIcon name="check" size={16} />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function LoadState({
  error,
  loading,
  retry,
}: {
  error: string;
  loading: boolean;
  retry: () => void;
}) {
  if (error)
    return (
      <div className="ds-error" role="alert">
        {error} <button onClick={retry}>Retry</button>
      </div>
    );
  return loading ? <p role="status">Loading…</p> : null;
}

export function Drawer({
  title,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = oldOverflow;
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="ds-drawer"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button
          type="button"
          className="ds-close"
          aria-label="Close panel"
          disabled={busy}
          onClick={onClose}
        >
          <OperationsIcon name="close" />
        </button>
      </header>
      <div className="ds-drawer-body">{children}</div>
    </dialog>
  );
}

export function PasswordField({
  label,
  value,
  onChange,
  disabled = false,
  newPassword = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  newPassword?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <label>
      {label}
      <span className="ds-password">
        <input
          required
          disabled={disabled}
          type={visible ? 'text' : 'password'}
          autoComplete={newPassword ? 'new-password' : 'current-password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
          onClick={() => setVisible(!visible)}
        >
          <OperationsIcon name="eye" size={18} />
        </button>
      </span>
    </label>
  );
}

export function Help({ title, items }: { title: string; items: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Card title="Need Help?" icon="info">
        <p>Learn more about {title.toLowerCase()}.</p>
        <button onClick={() => setOpen(true)}>View {title}</button>
      </Card>
      {open && (
        <Drawer title={title} onClose={() => setOpen(false)}>
          <Checklist items={items} />
          <footer>
            <button onClick={() => setOpen(false)}>Close</button>
          </footer>
        </Drawer>
      )}
    </>
  );
}

export function dateTime(value: string | null | undefined) {
  return value
    ? new Date(value).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : 'Not available';
}
