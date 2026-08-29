'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

/**
 * Fullscreen product image lightbox (Round 5 #18) — replaces the old
 * in-place 1.6x `.pdp__stage.is-zoomed` scale (that CSS rule is gone from
 * storefront-extend.css too; see product-detail.tsx). A real overlay:
 * click the main image to open it large, arrow buttons or a swipe to
 * move between images, Escape or the close button to leave. No portal —
 * matches how `toaster.tsx`/`pin-lock.tsx` already do a fullscreen overlay
 * in this codebase, a plain `fixed inset-0` div high enough in the z-index
 * scale (3100, above the toaster's 3000) to sit over everything.
 *
 * Renders the same 1500x1500 standardised URLs the gallery/thumbnails use —
 * there's no separate "full size" asset, `object-fit: contain` just gives
 * it more room than the PDP stage's fixed square.
 */
export function ImageLightbox({
  images,
  index,
  alt,
  onClose,
  onIndexChange,
}: {
  images: string[];
  index: number;
  alt: string;
  onClose: () => void;
  onIndexChange: (index: number) => void;
}) {
  const touchStartX = useRef<number | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const hasMultiple = images.length > 1;

  const goPrev = () => onIndexChange((index - 1 + images.length) % images.length);
  const goNext = () => onIndexChange((index + 1) % images.length);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && hasMultiple) goPrev();
      else if (e.key === 'ArrowRight' && hasMultiple) goNext();
    };
    window.addEventListener('keydown', onKey);
    // Lock page scroll while the lightbox is open — same reasoning the
    // cart drawer already needs (a fullscreen overlay with a scrollable
    // page underneath makes for a very confusing scroll target).
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, hasMultiple]);

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    setDragOffset((e.touches[0]?.clientX ?? 0) - touchStartX.current);
  };
  const onTouchEnd = () => {
    if (Math.abs(dragOffset) > 60 && hasMultiple) {
      if (dragOffset > 0) goPrev();
      else goNext();
    }
    touchStartX.current = null;
    setDragOffset(0);
  };

  return (
    <div
      className="fixed inset-0 z-[3100] flex flex-col bg-[rgba(10,7,6,.96)]"
      role="dialog"
      aria-modal="true"
      aria-label={`${alt} — image ${index + 1} of ${images.length}`}
      onClick={onClose}
    >
      {/* Round 5 #18 bug fix: text-bone/80 on a bg-black/30 circle read as
          "nearly invisible" against light product photos — two layers of
          transparency stacked on top of each other. Full-opacity icon on a
          solid, higher-contrast chrome fixes it regardless of what's behind
          the button; a visible border gives it an edge even over a
          near-white image where the fill alone wouldn't stand out. */}
      <button
        type="button"
        className="text-bone border-bone/30 absolute right-4 top-4 z-10 flex size-11 items-center justify-center rounded-full border bg-black/60 transition-colors hover:bg-black/80 sm:right-6 sm:top-6"
        onClick={onClose}
        aria-label="Close"
      >
        <X className="size-6" aria-hidden="true" />
      </button>

      {hasMultiple ? (
        <>
          <button
            type="button"
            className="text-bone border-bone/30 absolute left-2 top-1/2 z-10 flex size-11 -translate-y-1/2 items-center justify-center rounded-full border bg-black/60 transition-colors hover:bg-black/80 sm:left-6"
            onClick={(e) => {
              e.stopPropagation();
              goPrev();
            }}
            aria-label="Previous image"
          >
            <ChevronLeft className="size-7" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="text-bone border-bone/30 absolute right-2 top-1/2 z-10 flex size-11 -translate-y-1/2 items-center justify-center rounded-full border bg-black/60 transition-colors hover:bg-black/80 sm:right-6"
            onClick={(e) => {
              e.stopPropagation();
              goNext();
            }}
            aria-label="Next image"
          >
            <ChevronRight className="size-7" aria-hidden="true" />
          </button>
        </>
      ) : null}

      <div
        className="flex flex-1 items-center justify-center overflow-hidden p-6 sm:p-16"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- real, arbitrary Supabase Storage URLs */}
        <img
          src={images[index]}
          alt={alt}
          className="max-h-full max-w-full touch-pan-y select-none object-contain"
          style={{
            transform: dragOffset ? `translateX(${dragOffset}px)` : undefined,
            transition: dragOffset ? 'none' : 'transform 0.2s ease-out',
          }}
          draggable={false}
        />
      </div>

      {hasMultiple ? (
        <div
          className="text-bone/70 flex items-center justify-center gap-1.5 pb-6 text-xs font-semibold tracking-wide"
          onClick={(e) => e.stopPropagation()}
        >
          {images.map((url, i) => (
            <button
              key={url}
              type="button"
              className={
                i === index
                  ? 'bg-bone h-1.5 w-5 rounded-full transition-all'
                  : 'bg-bone/35 hover:bg-bone/60 h-1.5 w-1.5 rounded-full transition-all'
              }
              onClick={() => onIndexChange(i)}
              aria-label={`Go to image ${i + 1}`}
              aria-current={i === index}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
