'use client';

import { useCallback, useEffect, useRef } from 'react';
import { Bold, Italic, List, ListOrdered, Underline } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Minimal rich text editor for admin copy (product descriptions).
 *
 * Why contentEditable + execCommand and not an editor library: this needs
 * exactly five controls and, crucially, must KEEP formatting pasted from
 * Word, Google Docs or an AI tool. The browser already does that natively;
 * everything here is about sanitising what lands. `execCommand` is formally
 * deprecated but is still the universally-supported way to drive these five
 * commands, and swapping in TipTap/Lexical later touches only this file.
 *
 * Output is HTML — always run it through `sanitizeHtml` before storing or
 * rendering it. The backend MUST sanitise again server-side.
 */

const ALLOWED_TAGS = new Set([
  'P',
  'BR',
  'B',
  'STRONG',
  'I',
  'EM',
  'U',
  'UL',
  'OL',
  'LI',
  'DIV',
  'SPAN',
  'H3',
  'H4',
]);

/** Strip everything except the allowlisted tags; drop every attribute. */
export function sanitizeHtml(html: string): string {
  if (typeof window === 'undefined') return html;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');

  const walk = (node: Element) => {
    [...node.children].forEach((child) => {
      walk(child);
      if (!ALLOWED_TAGS.has(child.tagName)) {
        // Unwrap unknown tags (keeps their text), rather than deleting copy.
        child.replaceWith(...child.childNodes);
        return;
      }
      [...child.attributes].forEach((attr) => child.removeAttribute(attr.name));
    });
  };
  walk(doc.body);

  return doc.body.innerHTML.trim();
}

/** Plain text of an HTML string — for length validation and previews. */
export function htmlToText(html: string): string {
  if (typeof window === 'undefined') return html.replace(/<[^>]*>/g, ' ');
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

interface ToolbarButton {
  command: string;
  label: string;
  icon: typeof Bold;
}

const BUTTONS: ToolbarButton[] = [
  { command: 'bold', label: 'Bold', icon: Bold },
  { command: 'italic', label: 'Italic', icon: Italic },
  { command: 'underline', label: 'Underline', icon: Underline },
  { command: 'insertUnorderedList', label: 'Bulleted list', icon: List },
  { command: 'insertOrderedList', label: 'Numbered list', icon: ListOrdered },
];

export function RichTextEditor({
  id,
  value,
  onChange,
  placeholder,
  className,
}: {
  id?: string;
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Only write into the DOM when the value genuinely diverges, otherwise
  // every keystroke would reset the caret to the start.
  useEffect(() => {
    const el = ref.current;
    if (el && value !== el.innerHTML) el.innerHTML = value;
  }, [value]);

  const emit = useCallback(() => {
    const el = ref.current;
    if (el) onChange(sanitizeHtml(el.innerHTML));
  }, [onChange]);

  const exec = (command: string) => {
    ref.current?.focus();
    document.execCommand(command, false);
    emit();
  };

  /** Keep pasted formatting, drop pasted junk (Word/Docs styles, spans). */
  const onPaste = (e: React.ClipboardEvent) => {
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    if (!html && !text) return;
    e.preventDefault();
    const clean = html ? sanitizeHtml(html) : text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    document.execCommand('insertHTML', false, clean);
    emit();
  };

  return (
    <div className={cn('border-input rounded-ui bg-card overflow-hidden border', className)}>
      <div
        className="border-line flex flex-wrap gap-0.5 border-b p-1"
        role="toolbar"
        aria-label="Formatting"
      >
        {BUTTONS.map(({ command, label, icon: Icon }) => (
          <button
            key={command}
            type="button"
            title={label}
            aria-label={label}
            onMouseDown={(e) => e.preventDefault()} // keep the selection
            onClick={() => exec(command)}
            className="text-muted hover:bg-paper-2 hover:text-ink rounded-md p-1.5 transition-colors"
          >
            <Icon className="size-4" aria-hidden="true" />
          </button>
        ))}
      </div>
      <div
        id={id}
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder}
        onInput={emit}
        onBlur={emit}
        onPaste={onPaste}
        className="rt-input focus-visible:ring-ring min-h-[120px] px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset"
      />
    </div>
  );
}
