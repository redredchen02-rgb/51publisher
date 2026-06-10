interface Props {
  message?: string;
}

export function Loading({ message = '加载中…' }: Props) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: 32,
        color: 'var(--text-muted)',
      }}
    >
      <div className="spinner" />
      <span style={{ fontSize: 13 }}>{message}</span>
    </div>
  );
}
