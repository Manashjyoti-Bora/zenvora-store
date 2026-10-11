'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[ui:global-error]', error);
  }, [error]);

  return (
    <html lang="en-IN">
      <body
        style={{
          margin: 0,
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
          background: '#FAF8F3',
          color: '#101B16',
        }}
      >
        <main
          style={{
            maxWidth: 480,
            margin: '80px auto',
            padding: '32px 24px',
            textAlign: 'center',
            background: '#FFFFFF',
            borderRadius: 16,
            border: '1px solid rgba(16, 27, 22, 0.1)',
          }}
        >
          <p
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: '#266d49',
              margin: 0,
            }}
          >
            Service Interruption
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginTop: 8 }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: 14, color: '#5F7268', marginTop: 8, lineHeight: 1.5 }}>
            An unexpected error occurred while rendering this page.
          </p>
          {error.digest && (
            <p style={{ fontSize: 12, color: '#8A978F', fontFamily: 'monospace' }}>
              Ref: {error.digest}
            </p>
          )}
          <div style={{ marginTop: 20, display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button
              type="button"
              onClick={reset}
              style={{
                padding: '10px 18px',
                borderRadius: 10,
                border: 'none',
                background: '#266d49',
                color: '#fff',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
            <a
              href="/"
              style={{
                padding: '10px 18px',
                borderRadius: 10,
                border: '1px solid rgba(16, 27, 22, 0.2)',
                background: '#fff',
                color: '#101B16',
                textDecoration: 'none',
                fontWeight: 600,
              }}
            >
              Go home
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
