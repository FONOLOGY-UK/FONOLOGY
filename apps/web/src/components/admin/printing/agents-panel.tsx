'use client';

import { useState } from 'react';
import { Copy, KeyRound, Plus, Trash2 } from 'lucide-react';
import { useCreatePrintAgent, usePrintAgents, useRevokePrintAgent } from '@/lib/data/hooks';
import { toast } from '@/lib/stores/toast.store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * The till PC's print-agent tokens: add one, switch one off.
 *
 * The agent that drives the printers signs in with a token. The API could always create one, but nothing in
 * the dashboard did and nothing could cancel one - a token that leaked, or a till PC that was replaced, could
 * only be dealt with in the database. The token is shown ONCE when it is made (only its hash is stored), so
 * it is held in state here only until the owner has copied it.
 */
export function AgentsPanel() {
  const agents = usePrintAgents();
  const create = useCreatePrintAgent();
  const revoke = useRevokePrintAgent();
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(null);

  const live = (agents.data ?? []).filter((a) => !a.revokedAt);

  const add = () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) return;
    create.mutate(
      { name: trimmed, primary: live.length === 0 },
      {
        onSuccess: (agent) => {
          setFresh({ name: agent.name, token: agent.token });
          setName('');
        },
      },
    );
  };

  return (
    <section className="border-line bg-card rounded-lg border">
      <header className="border-line border-b px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <KeyRound className="size-4" aria-hidden /> Print agent tokens
        </h2>
        <p className="text-muted mt-0.5 text-xs">
          The till PC signs in with a token. Switch a token off if it was lost or the PC was
          replaced.
        </p>
      </header>

      {fresh ? (
        <div className="m-4 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
          <p className="text-[13px] font-semibold">Token for “{fresh.name}” — copy it now.</p>
          <p className="text-muted mt-0.5 text-xs">
            It is shown only this once and cannot be recovered.
          </p>
          <div className="mt-2 flex gap-2">
            <code className="bg-paper-2 min-w-0 flex-1 break-all rounded px-2 py-1.5 text-xs">
              {fresh.token}
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(fresh.token)
                  .then(() => toast('Token copied.'))
                  .catch(() => toast('Could not copy - select the token and copy it by hand.'));
              }}
            >
              <Copy className="size-4" aria-hidden /> Copy
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setFresh(null)}>
              Done
            </Button>
          </div>
        </div>
      ) : null}

      <ul className="divide-line divide-y">
        {live.length === 0 ? (
          <li className="text-muted px-4 py-3 text-xs">No active print agent token.</li>
        ) : (
          live.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="font-semibold">{a.name}</span>
              {a.isPrimary ? <span className="text-muted text-xs">primary</span> : null}
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto text-red-700"
                disabled={revoke.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      `Switch off “${a.name}”? The printers will stop until a new token is set up.`,
                    )
                  ) {
                    revoke.mutate(a.id);
                  }
                }}
              >
                <Trash2 className="size-4" aria-hidden /> Switch off
              </Button>
            </li>
          ))
        )}
      </ul>

      <div className="border-line flex gap-2 border-t p-4">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name, e.g. Till PC"
          aria-label="New print agent name"
          maxLength={60}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
        />
        <Button size="sm" onClick={add} disabled={create.isPending || name.trim().length < 2}>
          <Plus className="size-4" aria-hidden /> Add
        </Button>
      </div>
    </section>
  );
}
