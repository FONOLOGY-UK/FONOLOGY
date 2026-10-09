'use client';

import { useEffect, useRef, useState } from 'react';
import { MessageSquare, RotateCcw } from 'lucide-react';
import {
  useResetSmsTemplate,
  useSaveSmsTemplate,
  useSession,
  useSmsTemplates,
} from '@/lib/data/hooks';
import type { SmsTemplate } from '@/lib/data/types';
import { SMS_SAMPLE_VALUES, jobStatusLabel, renderSmsPreview, smsParts } from '@/lib/data/types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/admin/page-header';
import { StatusChip } from '@/components/admin/status-chip';

/**
 * Notifications (0105) — the text a customer gets at each stage of a repair job. Each shop can
 * word any stage its own way; a stage it hasn't changed uses the default. Pick a shop in the
 * switcher to edit its texts; the owner edits the defaults on the "Default texts" tab. (It used
 * to be "pick All shops" — but All shops is view only since C-4, so nobody could change them.)
 */

const STAGE_HINT: Record<SmsTemplate['status'], string> = {
  new: 'When a job is booked in — at the counter, or when an online booking becomes a job.',
  in_progress: 'When work starts (and when it resumes after the customer approves a new price).',
  waiting_approval: 'When the repair needs the customer’s OK for a new price.',
  done: 'When the repair is finished.',
  sent_back: 'When a mail-in device is posted back.',
  collected: 'When the customer collects their device.',
  cancelled: 'When the job is cancelled.',
};

export function NotificationsView() {
  const { data: session } = useSession();
  const isOwner = session?.kind === 'staff' && session.staffRole === 'owner';
  const [defaultsTab, setDefaultsTab] = useState(false);
  const showDefaults = isOwner && defaultsTab;
  const { data, isPending, isError, refetch } = useSmsTemplates(showDefaults);
  // On "All shops" the screen shows the defaults read-only — every change waits for a shop (C-4).
  const allShopsView = data?.scope === 'default' && !showDefaults;
  const editable = data ? data.scope === 'shop' || showDefaults : false;

  return (
    <div>
      <PageHeader
        eyebrow="Team"
        title="Notifications"
        description="The text a customer gets at each stage of a repair. Switch a stage off and nobody gets that text; a customer can also be opted out on their job."
      />

      {isOwner && !allShopsView ? (
        <div className="mb-4 flex gap-2" role="tablist" aria-label="Which texts">
          <Button
            type="button"
            role="tab"
            aria-selected={!defaultsTab}
            size="sm"
            variant={defaultsTab ? 'outline' : 'default'}
            onClick={() => setDefaultsTab(false)}
          >
            This shop’s texts
          </Button>
          <Button
            type="button"
            role="tab"
            aria-selected={defaultsTab}
            size="sm"
            variant={defaultsTab ? 'default' : 'outline'}
            onClick={() => setDefaultsTab(true)}
          >
            Default texts (every shop)
          </Button>
        </div>
      ) : null}

      {isError ? (
        <div className="border-line bg-card rounded-lg border p-8 text-center">
          <p className="text-ink mb-3 text-sm font-semibold">The texts didn’t load.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      ) : isPending ? (
        <div className="grid gap-3">
          <Skeleton className="h-[60px]" />
          <Skeleton className="h-[180px]" />
          <Skeleton className="h-[180px]" />
        </div>
      ) : (
        <div className="grid gap-4">
          <div className="border-line bg-card rounded-lg border p-4 text-sm">
            <p className="text-ink font-semibold">
              {data.scope === 'shop'
                ? `Editing the texts for ${data.shopName ?? 'this shop'}.`
                : 'Editing the default texts every shop uses.'}
            </p>
            <p className="text-muted mt-1 text-xs">
              {data.scope === 'shop'
                ? isOwner
                  ? 'A stage marked “Default” uses the shared wording until you change it here. Edit the shared wording on the Default texts tab.'
                  : 'A stage marked “Default” uses the shared wording until you change it here. Only the owner can change the defaults.'
                : allShopsView
                  ? 'Pick a shop in the switcher to change texts.'
                  : 'A shop’s own wording for a stage replaces the default for that shop only.'}
            </p>
            {data.smsMode !== 'brevo' ? (
              <p className="text-warning mt-2 text-xs font-semibold">
                {data.smsMode === 'log'
                  ? 'Test mode: texts are recorded on each job but not sent to anyone. They start going out once the server is set to send through Brevo.'
                  : 'Texts are turned off on the server.'}
              </p>
            ) : null}
            <p className="text-muted mt-2 text-xs">
              Fill-ins:{' '}
              {data.placeholders.map((p) => (
                <code key={p} className="bg-paper-2 mr-1 rounded px-1 py-0.5 text-[11px]">
                  {`{${p}}`}
                </code>
              ))}
            </p>
          </div>

          {data.templates.map((t) => (
            <StageCard
              key={`${data.scope}-${data.shopId ?? 'default'}-${t.status}`}
              template={t}
              scope={data.scope}
              editable={editable}
              defaults={showDefaults}
              shopName={data.shopName}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StageCard({
  template,
  scope,
  editable,
  defaults,
  shopName,
}: {
  template: SmsTemplate;
  scope: 'shop' | 'default';
  editable: boolean;
  defaults: boolean;
  shopName: string | null;
}) {
  const save = useSaveSmsTemplate(defaults);
  const reset = useResetSmsTemplate();
  const [body, setBody] = useState(template.body);
  const [enabled, setEnabled] = useState(template.enabled);
  const textRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    setBody(template.body);
    setEnabled(template.enabled);
  }, [template.body, template.enabled]);

  const dirty = body !== template.body || enabled !== template.enabled;
  const preview = renderSmsPreview(body, {
    ...SMS_SAMPLE_VALUES,
    ...(shopName ? { shopName } : {}),
  });
  const { parts, unicode } = smsParts(preview);

  return (
    <section className="border-line bg-card rounded-lg border p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MessageSquare className="text-muted size-4" aria-hidden="true" />
          <h2 className="text-ink text-sm font-bold">{jobStatusLabel(template.status)}</h2>
          {scope === 'shop' ? (
            template.source === 'shop' ? (
              <StatusChip tone="accent">This shop’s wording</StatusChip>
            ) : (
              <StatusChip tone="neutral">Default</StatusChip>
            )
          ) : null}
          {!template.enabled ? <StatusChip tone="warning">Off</StatusChip> : null}
        </div>
        <label className="text-ink flex items-center gap-2 text-xs font-semibold">
          <input
            type="checkbox"
            className="size-4 accent-[var(--red)]"
            checked={enabled}
            disabled={!editable}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Send this text
        </label>
      </div>
      <p className="text-muted mb-2 text-xs">{STAGE_HINT[template.status]}</p>
      <Textarea
        ref={textRef}
        value={body}
        disabled={!editable}
        maxLength={612}
        aria-label={`Text for ${jobStatusLabel(template.status)}`}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="mt-2 grid gap-1">
        <p className="text-muted text-[11px] font-bold uppercase tracking-[0.12em]">Preview</p>
        <p className="bg-paper-2 text-ink rounded-md px-3 py-2 text-sm">{preview || '—'}</p>
        <p className="text-muted tabular text-xs">
          About {preview.length} characters · {parts} {parts === 1 ? 'text' : 'texts'} per send
          {unicode ? ' (special characters make each text shorter)' : ''}
        </p>
      </div>
      {editable ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={!dirty || save.isPending || !body.trim()}
            onClick={() => save.mutate({ status: template.status, enabled, body })}
          >
            Save
          </Button>
          {dirty ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setBody(template.body);
                setEnabled(template.enabled);
              }}
            >
              Undo changes
            </Button>
          ) : null}
          {scope === 'shop' && template.source === 'shop' ? (
            <Button
              size="sm"
              variant="outline"
              disabled={reset.isPending}
              onClick={() => reset.mutate(template.status)}
            >
              <RotateCcw aria-hidden="true" />
              Use the default
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
