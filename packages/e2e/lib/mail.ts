/**
 * Reading what the system emailed, out of Mailpit (the local stack's inbox on :8025).
 * Used to confirm a customer's address exactly as a person would: by following the emailed link.
 */
export const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025';

/** The newest link to `path` in an email to `to`, waiting for delivery. */
export async function emailedLink(to: string, path: string): Promise<string> {
  const pattern = new RegExp(`(https?://[^\\s"'<>]*${path}\\?token=[A-Za-z0-9_%-]+)`);
  for (let attempt = 0; attempt < 40; attempt++) {
    const search = await fetch(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=5`,
    );
    const found = (await search.json()) as { messages?: { ID: string }[] };
    for (const { ID } of found.messages ?? []) {
      const message = (await (await fetch(`${MAILPIT}/api/v1/message/${ID}`)).json()) as {
        HTML?: string;
        Text?: string;
      };
      const match = pattern.exec(`${message.HTML ?? ''} ${message.Text ?? ''}`);
      if (match?.[1]) return match[1].replace(/&amp;/g, '&');
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no email with a ${path} link arrived for ${to}`);
}
