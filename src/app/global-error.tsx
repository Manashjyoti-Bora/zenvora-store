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
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#b45309"
            strokeWidth="1.5"
            aria-hidden="true"
            style={{ margin: '0 auto' }}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
            />
          </svg>
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
