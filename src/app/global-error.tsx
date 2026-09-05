'use client';

/** Last-resort boundary for errors in the root layout itself. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          background: '#f9fafb',
          color: '#111827',
          margin: 0,
        }}
      >
        <div style={{ maxWidth: 560, margin: '0 auto', padding: '64px 24px', textAlign: 'center' }}>
          <p style={{ fontSize: 48, margin: 0 }} aria-hidden="true">
            ⚠️
          </p>
          <h1 style={{ fontSize: 24, margin: '16px 0 8px' }}>The page failed to load</h1>
          <p style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.6 }}>
            An unexpected error occurred. Please try again — if it persists, contact support.
            {error.digest ? ` (Error ref: ${error.digest})` : ''}
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 24,
              background: '#20573c',
              color: 'white',
              border: 'none',
              borderRadius: 8,
              padding: '10px 24px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
