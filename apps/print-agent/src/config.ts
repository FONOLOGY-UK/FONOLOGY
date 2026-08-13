import fs from 'node:fs';
import { z } from 'zod';
import { CONFIG_FILE } from './paths.js';
import { registerSecret } from './logger.js';

/**
 * The agent's own configuration — the two facts it cannot discover.
 * =========================================================================
 * Only what is genuinely local lives here: WHERE the API is, and WHAT
 * credential to present. Everything about the printers themselves (transport,
 * paper width, roll size, codepage, cut behaviour) is deliberately NOT here —
 * it comes from `GET /print/config`, backed by `shop_settings.printer_config`,
 * so the owner can change it without anyone touching a shop PC. See
 * printerConfig.ts.
 *
 * That split is the difference between "the roll is a different size now" being
 * a settings edit and being a site visit to Glasgow.
 *
 * WHY A JSON FILE AND NOT ENVIRONMENT VARIABLES
 * apps/api uses .env.local because Coolify injects real env vars in
 * production, so env is the shape that deploys. Nothing injects env vars into
 * a Scheduled Task on a shop PC: you would have to set a machine-wide
 * environment variable and log out and back in for it to take effect, which is
 * not something a non-technical employee can be walked through on the phone.
 * A file the installer writes is the honest local equivalent.
 *
 * Env vars are still read, and win, because that is what makes the agent
 * testable without disturbing an installed configuration.
 */

const fileSchema = z.object({
  apiBaseUrl: z.string().url().optional(),
  token: z.string().min(1).optional(),
  lockPort: z.number().int().min(1024).max(65535).optional(),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).optional(),
});

export interface AgentConfig {
  apiBaseUrl: string;
  token: string;
  lockPort: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  configFile: string;
}

export class ConfigError extends Error {}

/**
 * 47od is arbitrary and that is fine — it only has to be a port nothing else
 * on a Windows till PC is likely to want. Overridable, because "unlikely" is
 * not "impossible" and a clash must be fixable without a new build.
 */
const DEFAULT_LOCK_PORT = 47016;

function readConfigFile(): z.infer<typeof fileSchema> {
  let raw: string;
  try {
    raw = fs.readFileSync(CONFIG_FILE, 'utf8');
  } catch {
    return {}; // absent is fine when env supplies everything
  }

  let parsedJson: unknown;
  try {
    // Strip a UTF-8 BOM before parsing. JSON.parse rejects one outright, and
    // every Windows tool that might touch this file adds it: PowerShell's
    // `Set-Content -Encoding utf8` on 5.1, and Notepad's "Save As UTF-8". The
    // resulting error ("not valid JSON") is baffling next to a file that looks
    // correct in an editor, so it is worth one line to never see it again.
    const withoutBom = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    parsedJson = JSON.parse(withoutBom);
  } catch {
    throw new ConfigError(
      `${CONFIG_FILE} is not valid JSON. Fix or delete it and re-run the installer.`,
    );
  }

  const parsed = fileSchema.safeParse(parsedJson);
  if (!parsed.success) {
    // Field names only. The file contains the token, and a validation error
    // that echoes the offending value would put it in the log.
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new ConfigError(`${CONFIG_FILE} has invalid field(s): ${fields}.`);
  }
  return parsed.data;
}

export function loadAgentConfig(): AgentConfig {
  const file = readConfigFile();

  const apiBaseUrl = process.env.FONOLOGY_API_URL ?? file.apiBaseUrl;
  const token = process.env.FONOLOGY_AGENT_TOKEN ?? file.token;

  // Fails fast and by name, matching apps/api/src/config.ts. Never falls back
  // to a placeholder that looks real — an agent pointed at localhost in a shop
  // would look alive and print nothing.
  const missing: string[] = [];
  if (!apiBaseUrl) missing.push('apiBaseUrl');
  if (!token) missing.push('token');
  if (missing.length > 0) {
    throw new ConfigError(
      `Print agent is not configured: missing ${missing.join(' and ')}. ` +
        `Expected them in ${CONFIG_FILE} (written by the installer) ` +
        `or in FONOLOGY_API_URL / FONOLOGY_AGENT_TOKEN.`,
    );
  }

  // Registered before anything else can log. From this point the token cannot
  // appear in a log line even if some error object carries it.
  registerSecret(token);

  const lockPortRaw = process.env.FONOLOGY_AGENT_LOCK_PORT;
  const lockPort = lockPortRaw ? Number(lockPortRaw) : (file.lockPort ?? DEFAULT_LOCK_PORT);
  if (!Number.isInteger(lockPort) || lockPort < 1024 || lockPort > 65535) {
    throw new ConfigError(`Invalid lock port: ${String(lockPortRaw ?? file.lockPort)}`);
  }

  const logLevel =
    (process.env.FONOLOGY_AGENT_LOG_LEVEL as AgentConfig['logLevel'] | undefined) ??
    file.logLevel ??
    'info';

  return {
    // Trailing slashes make every downstream URL join produce a double slash,
    // which some proxies answer with a 404 and no explanation.
    apiBaseUrl: apiBaseUrl!.replace(/\/+$/, ''),
    token: token!,
    lockPort,
    logLevel,
    configFile: CONFIG_FILE,
  };
}
