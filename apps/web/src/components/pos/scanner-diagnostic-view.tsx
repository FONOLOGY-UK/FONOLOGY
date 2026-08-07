'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ScanBarcode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  SCAN_MAX_KEY_INTERVAL_MS,
  SCAN_END_TIMEOUT_MS,
  DEFAULT_SCAN_TERMINATORS,
} from '@/lib/scanner/scan-capture';

/**
 * A raw capture of one scan — every keystroke and the gap before it. This is
 * a DIAGNOSTIC TOOL, not part of the scanner itself: it does not import or
 * exercise `createScanCapture`'s gating logic at all, on purpose. The
 * production code discards timing the instant it has decided scan-vs-typing;
 * this keeps every millisecond so a real scanner's numbers can be read off
 * directly and compared against the constant the production code actually
 * uses, `SCAN_MAX_KEY_INTERVAL_MS`.
 *
 * Built because `SCAN_MAX_KEY_INTERVAL_MS = 35` is a value chosen from
 * published HID scanner speeds, never confirmed against the shop's own
 * Eyoyo EY-7130. Point this page at the scanner once, scan anything, and the
 * three numbers this reads off settle whether the constant needs changing —
 * no code archaeology required.
 */

interface CapturedKey {
  key: string;
  /** Milliseconds since the previous key in this capture (0 for the first). */
  gapMs: number;
}

interface CaptureResult {
  keys: CapturedKey[];
  terminator: string | null;
  endedBy: 'terminator' | 'timeout';
}

const IDLE_TIMEOUT_MS = 500; // generous — this tool waits far longer than production does

export function ScannerDiagnosticView() {
  const [listening, setListening] = useState(false);
  const [result, setResult] = useState<CaptureResult | null>(null);

  const keysRef = useRef<CapturedKey[]>([]);
  const lastAtRef = useRef<number>(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finish = useCallback((endedBy: CaptureResult['endedBy'], terminatorKey: string | null) => {
    setResult({ keys: keysRef.current, terminator: terminatorKey, endedBy });
    setListening(false);
  }, []);

  useEffect(() => {
    if (!listening) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const now = performance.now();

      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);

      if (DEFAULT_SCAN_TERMINATORS.includes(e.key as (typeof DEFAULT_SCAN_TERMINATORS)[number])) {
        e.preventDefault();
        finish('terminator', e.key);
        return;
      }

      const gapMs = keysRef.current.length === 0 ? 0 : Math.round(now - lastAtRef.current);
      keysRef.current = [...keysRef.current, { key: e.key, gapMs }];
      lastAtRef.current = now;

      idleTimerRef.current = setTimeout(() => finish('timeout', null), IDLE_TIMEOUT_MS);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [listening, finish]);

  const start = useCallback(() => {
    keysRef.current = [];
    lastAtRef.current = 0;
    setResult(null);
    setListening(true);
  }, []);

  const gaps = result ? result.keys.slice(1).map((k) => k.gapMs) : [];
  const maxGap = gaps.length ? Math.max(...gaps) : null;
  const minGap = gaps.length ? Math.min(...gaps) : null;
  const withinThreshold = maxGap !== null && maxGap <= SCAN_MAX_KEY_INTERVAL_MS;

  return (
    <div className="mx-auto grid max-w-[640px] gap-6 px-4 py-8 sm:px-6">
      <div>
        <h1 className="font-display text-ink text-xl font-extrabold uppercase tracking-tight">
          Scanner diagnostic
        </h1>
        <p className="text-muted mt-1 text-sm">
          Not part of the till. Click Start, then scan any barcode with the real Eyoyo unit — this
          reads off its actual timing, terminator, and whether it fits the threshold the till
          scanner already uses.
        </p>
      </div>

      <div className="border-line bg-card rounded-lg border p-6 text-center">
        {listening ? (
          <>
            <ScanBarcode
              className="text-red-deep mx-auto mb-3 size-8 animate-pulse"
              aria-hidden="true"
            />
            <p className="text-ink text-sm font-semibold">Listening — scan now</p>
            <p className="text-muted mt-1 text-xs">
              Any focused field is fine; this listens on the whole page. Waits up to{' '}
              {IDLE_TIMEOUT_MS}ms of silence before giving up.
            </p>
          </>
        ) : (
          <Button onClick={start}>{result ? 'Scan again' : 'Start'}</Button>
        )}
      </div>

      {result ? (
        <div className="border-line bg-card grid gap-4 rounded-lg border p-6">
          {result.keys.length === 0 ? (
            <div className="text-red-deep flex items-center gap-2 text-sm font-semibold">
              <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
              Nothing captured —{' '}
              {result.endedBy === 'terminator'
                ? 'a terminator arrived with no characters before it'
                : 'timed out with no keystrokes at all'}
              . Check the scanner is actually configured to send data on this connection.
            </div>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted">Characters captured</dt>
                <dd className="tabular text-ink font-semibold">{result.keys.length}</dd>

                <dt className="text-muted">Decoded value</dt>
                <dd className="tabular text-ink break-all font-semibold">
                  {result.keys.map((k) => k.key).join('')}
                </dd>

                <dt className="text-muted">Terminator</dt>
                <dd className="text-ink font-semibold">
                  {result.terminator ?? 'None sent — ended by the idle timeout'}
                </dd>

                <dt className="text-muted">Slowest gap between keys</dt>
                <dd className="tabular text-ink font-semibold">
                  {maxGap === null ? '—' : `${maxGap}ms`}
                </dd>

                <dt className="text-muted">Fastest gap between keys</dt>
                <dd className="tabular text-ink font-semibold">
                  {minGap === null ? '—' : `${minGap}ms`}
                </dd>

                <dt className="text-muted">Current threshold (SCAN_MAX_KEY_INTERVAL_MS)</dt>
                <dd className="tabular text-ink font-semibold">{SCAN_MAX_KEY_INTERVAL_MS}ms</dd>

                <dt className="text-muted">Idle-timeout fallback (SCAN_END_TIMEOUT_MS)</dt>
                <dd className="tabular text-ink font-semibold">{SCAN_END_TIMEOUT_MS}ms</dd>
              </dl>

              <div
                className={`rounded-md border px-3 py-2.5 text-sm font-semibold ${
                  withinThreshold
                    ? 'border-green-600/30 bg-green-50 text-green-900'
                    : 'border-red-deep/30 text-red-deep bg-red-50'
                }`}
              >
                {withinThreshold
                  ? 'Within the current threshold — the real till will recognise this scanner correctly with no change needed.'
                  : `Exceeds the current threshold (${SCAN_MAX_KEY_INTERVAL_MS}ms) — this scanner is slower than assumed. Raise SCAN_MAX_KEY_INTERVAL_MS in apps/web/src/lib/scanner/scan-capture.ts to at least ${maxGap}ms (comfortably above the slowest gap seen, comfortably below normal human typing, ~90ms+).`}
              </div>

              <details className="text-muted text-xs">
                <summary className="cursor-pointer select-none">Per-character gaps (raw)</summary>
                <ul className="tabular mt-2 grid grid-cols-4 gap-1">
                  {result.keys.map((k, i) => (
                    <li key={i}>
                      {JSON.stringify(k.key)} +{k.gapMs}ms
                    </li>
                  ))}
                </ul>
              </details>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
