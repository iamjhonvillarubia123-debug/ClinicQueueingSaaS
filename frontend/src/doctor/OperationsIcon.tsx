export type OperationsIconName =
  | 'calendar' | 'check' | 'clinic' | 'clock' | 'close' | 'coffee' | 'eye'
  | 'globe' | 'info' | 'mail' | 'person' | 'play' | 'plus' | 'print'
  | 'procedure' | 'shield' | 'swap' | 'users';

type Props = { name: OperationsIconName; className?: string; size?: number };

export function OperationsIcon({ name, className, size = 22 }: Props) {
  const paths: Record<OperationsIconName, React.ReactNode> = {
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    clinic: <><path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-5h6v5"/><path d="M12 7v5M9.5 9.5h5"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    coffee: <><path d="M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Z"/><path d="M17 10h1a3 3 0 0 1 0 6h-2M7 3v2M11 3v2M15 3v2"/></>,
    eye: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/></>,
    globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></>,
    person: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
    play: <path d="m8 5 11 7-11 7V5Z"/>,
    plus: <path d="M12 5v14M5 12h14"/>,
    print: <><path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="7" y="14" width="10" height="7"/></>,
    procedure: <><path d="M8 4h8M12 4v7M7 20h10M9 11h6l2 9H7l2-9Z"/><path d="m17 7 2-2M7 7 5 5"/></>,
    shield: <><path d="M12 3 20 6v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Z"/><path d="M12 8v6M9 11h6"/></>,
    swap: <><path d="M7 7h11l-3-3M17 17H6l3 3"/><path d="M18 7v4M6 17v-4"/></>,
    users: <><circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0M16 5a3 3 0 0 1 0 6M17 14a5 5 0 0 1 4 5"/></>,
  };
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
