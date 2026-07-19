'use client';

import { useEffect, useState } from 'react';
import { Plus, Printer, Trash2, X } from 'lucide-react';
import { useDeleteLabelTemplate, useLabelTemplates, useSaveLabelTemplate } from '@/lib/data/hooks';
import type { LabelLine, LabelTemplate } from '@/lib/data/types';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { Field } from '@/components/admin/field';
import { PageHeader } from '@/components/admin/page-header';
import { Code39 } from '@/components/admin/jobs/job-label';
import { cn } from '@/lib/utils';

/**
 * Generate Label (item 7): free-form shelf/price/info labels with saveable
 * templates, optional REAL Code 39 barcode, live preview and print-optimised
 * output. Separate from the Jobs module's device labels.
 */

interface Draft {
  id: string | null;
  name: string;
  lines: LabelLine[];
  hasBarcode: boolean;
  barcode: string;
}

const BLANK: Draft = {
  id: null,
  name: '',
  lines: [{ text: '', size: 'md', bold: true }],
  hasBarcode: false,
  barcode: '',
};

function toDraft(template: LabelTemplate): Draft {
  return {
    id: template.id,
    name: template.name,
    lines: template.lines.map((l) => ({ ...l })),
    hasBarcode: template.barcode !== null,
    barcode: template.barcode ?? '',
  };
}

export function LabelsView() {
  const { data: templates, isPending, isError, refetch } = useLabelTemplates();
  const saveTemplate = useSaveLabelTemplate();
  const deleteTemplate = useDeleteLabelTemplate();

  const [draft, setDraft] = useState<Draft>(BLANK);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Open the first template once they load (fresh visit only).
  useEffect(() => {
    if (templates && templates.length > 0 && draft === BLANK) {
      const first = templates[0];
      if (first) setDraft(toDraft(first));
    }
  }, [templates, draft]);

  const patch = (part: Partial<Draft>) => setDraft((d) => ({ ...d, ...part }));
  const patchLine = (i: number, part: Partial<LabelLine>) =>
    setDraft((d) => ({
      ...d,
      lines: d.lines.map((line, j) => (j === i ? { ...line, ...part } : line)),
    }));

  const canSave = draft.name.trim().length >= 2 && draft.lines.some((l) => l.text.trim());

  const save = (asNew: boolean) => {
    saveTemplate.mutate(
      {
        ...(asNew || !draft.id ? {} : { id: draft.id }),
        name: draft.name.trim(),
        lines: draft.lines.filter((l) => l.text.trim().length > 0),
        barcode: draft.hasBarcode && draft.barcode.trim() ? draft.barcode.trim() : null,
      },
      { onSuccess: (saved) => setDraft(toDraft(saved)) },
    );
  };

  return (
    <div>
      <PageHeader
        eyebrow="Catalogue"
        title="Labels"
        description="Shelf and price labels with saveable templates. Device labels print from Jobs."
        actions={
          <Button
            variant="outline"
            onClick={() => setDraft({ ...BLANK, lines: [{ text: '', size: 'md', bold: true }] })}
          >
            <Plus aria-hidden="true" />
            New template
          </Button>
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-[240px_1fr]">
        {/* Template list */}
        <aside className="border-line bg-card rounded-lg border p-2">
          <p className="text-muted px-2 pb-1.5 pt-1 text-[11px] font-bold uppercase tracking-[0.14em]">
            Templates
          </p>
          {isError ? (
            <div className="p-3 text-center">
              <p className="text-ink mb-2 text-xs font-semibold">Didn’t load.</p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Try again
              </Button>
            </div>
          ) : isPending ? (
            <div className="grid gap-1.5 p-1">
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
            </div>
          ) : templates && templates.length > 0 ? (
            <ul className="grid gap-0.5">
              {templates.map((t) => (
                <li key={t.id}>
                  <button
                    onClick={() => setDraft(toDraft(t))}
                    className={cn(
                      'w-full rounded-md px-2.5 py-2 text-left text-[13px] font-semibold transition-colors duration-150',
                      draft.id === t.id
                        ? 'bg-red-tint text-red-deep'
                        : 'text-ink-2 hover:bg-paper-2/70',
                    )}
                  >
                    {t.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted px-2.5 py-3 text-xs">No templates saved yet.</p>
          )}
        </aside>

        {/* Editor + preview */}
        <div className="grid items-start gap-4 xl:grid-cols-[1fr_300px]">
          <section className="border-line bg-card grid gap-4 rounded-lg border p-4">
            <Field label="Template name" htmlFor="lbl-name">
              <Input
                id="lbl-name"
                placeholder="e.g. Shelf price label"
                value={draft.name}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </Field>

            <div>
              <p className="text-ink mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em]">
                Lines
              </p>
              <div className="grid gap-2">
                {draft.lines.map((line, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      value={line.text}
                      placeholder={i === 0 ? 'e.g. Aegis Mag Case' : 'Line text'}
                      onChange={(e) => patchLine(i, { text: e.target.value })}
                      className="flex-1"
                      aria-label={`Line ${i + 1} text`}
                    />
                    <Select
                      value={line.size}
                      onChange={(e) => patchLine(i, { size: e.target.value as LabelLine['size'] })}
                      className="w-[74px]"
                      aria-label={`Line ${i + 1} size`}
                    >
                      <option value="sm">Small</option>
                      <option value="md">Med</option>
                      <option value="lg">Big</option>
                    </Select>
                    <label className="flex items-center gap-1 text-xs font-semibold">
                      <input
                        type="checkbox"
                        className="accent-[var(--red)]"
                        checked={line.bold}
                        onChange={(e) => patchLine(i, { bold: e.target.checked })}
                      />
                      Bold
                    </label>
                    {draft.lines.length > 1 ? (
                      <button
                        onClick={() =>
                          setDraft((d) => ({ ...d, lines: d.lines.filter((_, j) => j !== i) }))
                        }
                        className="text-muted hover:text-red-deep p-1"
                        aria-label={`Remove line ${i + 1}`}
                      >
                        <X className="size-4" />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
              {draft.lines.length < 6 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      lines: [...d.lines, { text: '', size: 'sm', bold: false }],
                    }))
                  }
                >
                  <Plus aria-hidden="true" />
                  Add line
                </Button>
              ) : null}
            </div>

            <div className="border-line rounded-ui border p-3">
              <label className="flex items-center gap-2.5 text-sm font-semibold">
                <input
                  type="checkbox"
                  className="accent-[var(--red)]"
                  checked={draft.hasBarcode}
                  onChange={(e) => patch({ hasBarcode: e.target.checked })}
                />
                Barcode (Code 39 — scannable)
              </label>
              {draft.hasBarcode ? (
                <Input
                  className="tabular mt-2.5"
                  placeholder="Value, e.g. 5060412340015"
                  value={draft.barcode}
                  onChange={(e) => patch({ barcode: e.target.value })}
                  aria-label="Barcode value"
                />
              ) : null}
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              {draft.id ? (
                <>
                  <Button
                    variant="ghost"
                    className="text-muted hover:text-red-deep mr-auto"
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2 aria-hidden="true" />
                    Delete
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => save(true)}
                    disabled={!canSave || saveTemplate.isPending}
                  >
                    Save as new
                  </Button>
                </>
              ) : null}
              <Button onClick={() => save(false)} disabled={!canSave || saveTemplate.isPending}>
                {saveTemplate.isPending ? 'Saving…' : draft.id ? 'Save changes' : 'Save template'}
              </Button>
            </div>
          </section>

          {/* Live preview */}
          <section className="grid gap-3">
            <p className="text-muted text-[11px] font-bold uppercase tracking-[0.14em]">Preview</p>
            {draft.lines.some((l) => l.text.trim()) || (draft.hasBarcode && draft.barcode) ? (
              <>
                <div className="print-area border-line-strong shadow-card w-full max-w-[300px] rounded-sm border bg-white p-4 text-black">
                  {draft.lines
                    .filter((l) => l.text.trim())
                    .map((line, i) => (
                      <p
                        key={i}
                        className={cn(
                          'leading-snug',
                          line.size === 'lg' && 'font-display text-[26px] tracking-tight',
                          line.size === 'md' && 'text-[16px]',
                          line.size === 'sm' && 'text-[12px]',
                          line.bold && 'font-extrabold',
                        )}
                      >
                        {line.text}
                      </p>
                    ))}
                  {draft.hasBarcode && draft.barcode.trim() ? (
                    <div className="mt-2">
                      <Code39 value={draft.barcode.trim()} height={30} />
                      <p className="tabular mt-0.5 text-center text-[10px]">{draft.barcode}</p>
                    </div>
                  ) : null}
                </div>
                <Button variant="outline" onClick={() => window.print()}>
                  <Printer aria-hidden="true" />
                  Print label
                </Button>
              </>
            ) : (
              <EmptyState
                title="Nothing to preview"
                description="Type a line and the label appears here at print size."
                className="border-line rounded-lg border border-dashed py-10"
              />
            )}
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this template?"
        description={`“${draft.name}” is removed from the saved templates. Printed labels are unaffected.`}
        confirmLabel="Delete template"
        destructive
        loading={deleteTemplate.isPending}
        onConfirm={() => {
          if (!draft.id) return;
          deleteTemplate.mutate(draft.id, {
            onSuccess: () => {
              setConfirmDelete(false);
              setDraft(BLANK);
            },
          });
        }}
      />
    </div>
  );
}
