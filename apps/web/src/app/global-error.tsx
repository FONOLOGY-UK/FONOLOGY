'use client';

/**
 * Global error boundary — catches errors in the root layout itself. Must render
 * its own <html>/<body>. Kept intentionally minimal (no providers available).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en-GB">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
          fontFamily: 'system-ui, sans-serif',
          background: '#F2F0EC',
          color: '#181010',
          textAlign: 'center',
          padding: '2rem',
        }}
      >
        <h1 style={{ fontSize: '1.5rem', margin: 0 }}>Something went wrong</h1>
        <p style={{ color: '#7B706A', maxWidth: '28rem' }}>
          {error.message || 'A critical error occurred.'}
        </p>
        <button
          onClick={reset}
          style={{
            background: '#E8250C',
            color: '#fff',
            border: 0,
            borderRadius: 999,
            padding: '0.75rem 1.5rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
