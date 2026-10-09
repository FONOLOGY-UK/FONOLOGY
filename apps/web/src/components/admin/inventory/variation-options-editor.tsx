'use client';

import { useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2, X } from 'lucide-react';
import type { VariationStructureInput, VariationType } from '@/lib/data/types';
import { isColourOption } from '@/lib/data/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * The option structure of a variation product, as a draft (0107, spec §3.2 and §6.4): option
 * types (Colour, Compatibility …) and their values, both drag-and-drop ordered — the order the
 * customer sees. A value is added by typing it and pressing Enter, or by pasting a comma-separated
 * list. A colour option gets a swatch colour per value, picked the way JeezMart does: a colour
 * input beside the value box, and the dot on the chip to change it later.
 *
 * Nothing here saves: the caller decides when (with the product on create, or through "Update
 * variations" on edit).
 */

export interface DraftValue {
  key: string;
  id?: string;
  value: string;
  swatchHex: string | null;
}
export interface DraftType {
  key: string;
  id?: string;
  name: string;
  values: DraftValue[];
}

let seq = 0;
const newKey = () => `k${(seq += 1)}`;

/** Draft from what the server has saved. */
export function draftFromTypes(types: VariationType[]): DraftType[] {
  return types.map((t) => ({
    key: newKey(),
    id: t.id,
    name: t.name,
    values: t.values.map((v) => ({
      key: newKey(),
      id: v.id,
      value: v.value,
      swatchHex: v.swatchHex,
    })),
  }));
}

/** The draft as the API takes it. */
export function draftToInput(draft: DraftType[]): VariationStructureInput['types'] {
  return draft.map((t) => {
    const colour = isColourOption(t.name);
    return {
      ...(t.id ? { id: t.id } : {}),
      name: t.name.trim(),
      values: t.values.map((v) => ({
        ...(v.id ? { id: v.id } : {}),
        value: v.value.trim(),
        swatchHex: colour ? v.swatchHex : null,
      })),
    };
  });
}

/** How many variations the draft makes (every combination). */
export function combinationCount(draft: DraftType[]): number {
  if (draft.length === 0) return 0;
  return draft.reduce((n, t) => n * t.values.length, 1);
}

/** Why the draft can't be saved yet, or null. */
export function draftProblem(draft: DraftType[]): string | null {
  if (draft.length === 0) return 'Add at least one option, e.g. Colour.';
  const names = new Set<string>();
  for (const t of draft) {
    if (!t.name.trim()) return 'Every option needs a name.';
    if (names.has(t.name.trim().toLowerCase())) return `There are two options called “${t.name}”.`;
    names.add(t.name.trim().toLowerCase());
    if (t.values.length === 0) return `Add at least one value to ${t.name}.`;
  }
  return null;
}

const SUGGESTIONS = ['Colour', 'Compatibility', 'Size', 'Storage'];

/** A first guess at a swatch from the colour's name — the admin can change it on the chip. */
const NAMED: Record<string, string> = {
  black: '#1a1a1a',
  white: '#f5f5f5',
  grey: '#8e8e93',
  gray: '#8e8e93',
  silver: '#c7c7cc',
  gold: '#d4af37',
  red: '#d42a1c',
  pink: '#f4a6c1',
  purple: '#7e57c2',
  blue: '#1e63d6',
  navy: '#1f2a44',
  green: '#2e8b57',
  yellow: '#f5d020',
  orange: '#f28c28',
  brown: '#8b5a2b',
  beige: '#e8dcc4',
  clear: '#eef2f5',
  transparent: '#eef2f5',
};

/** Reorders `list` by moving the item at `from` to `to`. */
function move<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

export function VariationOptionsEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: DraftType[];
  onChange: (next: DraftType[]) => void;
  disabled?: boolean;
}) {
  const [newType, setNewType] = useState('');
  const [typeError, setTypeError] = useState<string | null>(null);
  // Which type is being dragged (types reorder among themselves, values within their type).
  const dragType = useRef<number | null>(null);
  const [overType, setOverType] = useState<number | null>(null);

  const addType = (raw: string) => {
    const name = raw.trim();
    if (!name) return;
    if (value.some((t) => t.name.trim().toLowerCase() === name.toLowerCase())) {
      setTypeError(`There is already an option called “${name}”.`);
      return;
    }
    setTypeError(null);
    onChange([...value, { key: newKey(), name, values: [] }]);
    setNewType('');
  };

  const updateType = (index: number, next: DraftType) =>
    onChange(value.map((t, i) => (i === index ? next : t)));

  const unused = SUGGESTIONS.filter(
    (s) => !value.some((t) => t.name.trim().toLowerCase() === s.toLowerCase()),
  );

  return (
    <div className="grid gap-3">
      {value.map((type, index) => (
        <div
          key={type.key}
          onDragOver={(e) => {
            if (dragType.current === null) return;
            e.preventDefault();
            setOverType(index);
          }}
          onDragLeave={() => setOverType((o) => (o === index ? null : o))}
          onDrop={(e) => {
            if (dragType.current === null) return;
            e.preventDefault();
            const from = dragType.current;
            dragType.current = null;
            setOverType(null);
            if (from !== index) onChange(move(value, from, index));
          }}
          className={cn(
            'border-line bg-paper rounded-ui border p-3 transition-colors',
            overType === index && 'border-red bg-red-tint/30',
          )}
        >
          <div className="flex items-center gap-2">
            <span
              draggable={!disabled}
              onDragStart={(e) => {
                dragType.current = index;
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => {
                dragType.current = null;
                setOverType(null);
              }}
              className="text-muted cursor-grab active:cursor-grabbing"
              title="Drag to reorder"
              aria-hidden="true"
            >
              <GripVertical />
            </span>
            <Input
              aria-label="Option name"
              value={type.name}
              disabled={disabled}
              onChange={(e) => updateType(index, { ...type, name: e.target.value })}
              className="h-9 max-w-[240px] font-semibold"
              placeholder="Option name, e.g. Colour"
            />
            {isColourOption(type.name) ? (
              <span className="text-muted text-xs">Shown as colour swatches</span>
            ) : null}
            <div className="ml-auto flex items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`Move ${type.name} up`}
                disabled={disabled || index === 0}
                onClick={() => onChange(move(value, index, index - 1))}
              >
                <ArrowUp />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`Move ${type.name} down`}
                disabled={disabled || index === value.length - 1}
                onClick={() => onChange(move(value, index, index + 1))}
              >
                <ArrowDown />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`Remove ${type.name}`}
                disabled={disabled}
                onClick={() => onChange(value.filter((_, i) => i !== index))}
              >
                <Trash2 />
              </Button>
            </div>
          </div>
          <ValuesEditor
            type={type}
            disabled={disabled}
            onChange={(values) => updateType(index, { ...type, values })}
          />
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="New option name"
          value={newType}
          disabled={disabled}
          onChange={(e) => setNewType(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addType(newType);
            }
          }}
          placeholder="Add an option, e.g. Colour"
          className="h-9 max-w-[240px]"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || !newType.trim()}
          onClick={() => addType(newType)}
        >
          <Plus /> Add option
        </Button>
        {unused.map((s) => (
          <button
            key={s}
            type="button"
            disabled={disabled}
            onClick={() => addType(s)}
            className="border-line text-muted hover:border-red hover:text-ink rounded-full border px-3 py-1 text-xs font-semibold"
          >
            + {s}
          </button>
        ))}
      </div>
      {typeError ? (
        <p role="alert" className="text-red-deep text-xs font-medium">
          {typeError}
        </p>
      ) : null}
    </div>
  );
}

function ValuesEditor({
  type,
  disabled,
  onChange,
}: {
  type: DraftType;
  disabled: boolean;
  onChange: (values: DraftValue[]) => void;
}) {
  const colour = isColourOption(type.name);
  const [draft, setDraft] = useState('');
  const [hex, setHex] = useState('#000000');
  // Until the admin picks a colour, a known colour name brings its own swatch.
  const [hexPicked, setHexPicked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragValue = useRef<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  /** Adds each new value; reports the ones already there. */
  const add = (raw: string[]) => {
    const seen = new Set(type.values.map((v) => v.value.trim().toLowerCase()));
    const added: DraftValue[] = [];
    const dupes: string[] = [];
    for (const r of raw) {
      const v = r.trim();
      if (!v) continue;
      if (seen.has(v.toLowerCase())) {
        dupes.push(v);
        continue;
      }
      seen.add(v.toLowerCase());
      const guess = NAMED[v.toLowerCase()] ?? NAMED[v.toLowerCase().split(/s+/).pop() ?? ''];
      added.push({
        key: newKey(),
        value: v,
        swatchHex: colour ? (hexPicked ? hex : (guess ?? hex)) : null,
      });
    }
    if (added.length) onChange([...type.values, ...added]);
    setError(dupes.length ? `Already added: ${dupes.join(', ')}` : null);
    setDraft('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add(draft.split(','));
    }
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (/[,\n]/.test(text)) {
      e.preventDefault();
      add(text.split(/[,\n]/));
    }
  };

  const dropOn = (e: DragEvent, index: number) => {
    if (dragValue.current === null) return;
    e.preventDefault();
    e.stopPropagation();
    const from = dragValue.current;
    dragValue.current = null;
    setOver(null);
    if (from !== index) onChange(move(type.values, from, index));
  };

  return (
    <div className="mt-3 grid gap-2">
      {type.values.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label={`${type.name || 'Option'} values`}>
          {type.values.map((v, i) => (
            <li
              key={v.key}
              draggable={!disabled}
              onDragStart={(e) => {
                e.stopPropagation();
                dragValue.current = i;
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => {
                dragValue.current = null;
                setOver(null);
              }}
              onDragOver={(e) => {
                if (dragValue.current === null) return;
                e.preventDefault();
                e.stopPropagation();
                setOver(i);
              }}
              onDrop={(e) => dropOn(e, i)}
              className={cn(
                'border-line bg-paper-2/60 inline-flex cursor-grab items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold active:cursor-grabbing',
                over === i && 'border-red',
              )}
              title="Drag to reorder"
            >
              {colour ? (
                <label
                  className="relative inline-flex size-4 shrink-0 cursor-pointer overflow-hidden rounded-full border border-black/15"
                  style={{ backgroundColor: v.swatchHex ?? '#e5e7eb' }}
                  title={`Change the ${v.value} swatch`}
                >
                  <input
                    type="color"
                    aria-label={`${v.value} swatch colour`}
                    value={v.swatchHex ?? '#000000'}
                    disabled={disabled}
                    onChange={(e) =>
                      onChange(
                        type.values.map((x, j) =>
                          j === i ? { ...x, swatchHex: e.target.value.toLowerCase() } : x,
                        ),
                      )
                    }
                    className="absolute inset-0 cursor-pointer opacity-0"
                  />
                </label>
              ) : null}
              {v.value}
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(type.values.filter((_, j) => j !== i))}
                className="text-muted hover:text-red-deep"
                aria-label={`Remove ${v.value}`}
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={`Add a ${type.name || 'value'}`}
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={
            colour
              ? 'Colour name, then Enter'
              : 'Type a value and press Enter — or paste a list: A, B, C'
          }
          className="h-9 min-w-0 flex-1"
        />
        {colour ? (
          <input
            type="color"
            aria-label="Swatch colour for the next value"
            value={hex}
            disabled={disabled}
            onChange={(e) => {
              setHex(e.target.value.toLowerCase());
              setHexPicked(true);
            }}
            className="border-line h-9 w-14 cursor-pointer rounded-md border bg-white px-1"
          />
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || !draft.trim()}
          onClick={() => add(draft.split(','))}
        >
          Add
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-red-deep text-xs font-medium">
          {error}
        </p>
      ) : null}
    </div>
  );
}
