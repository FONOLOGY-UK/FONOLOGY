import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

/**
 * Where the agent keeps its state on the till PC.
 * =========================================================================
 * One directory holds everything that must survive a reboot: the config file,
 * the installation id, the crash marker, the logs, and the fake printer's
 * output.
 *
 * WHY %PROGRAMDATA% AND NOT %LOCALAPPDATA%
 * The install plan is a Scheduled Task running as the till user (see
 * install/README.md for why that beats a LocalSystem service). Today that is
 * one user. But shops change: a second Windows account gets made, someone logs
 * in as "Manager" instead of "Till", and with a per-user directory the agent
 * would silently come up with no config, no marker history, and — worst —
 * no knowledge of the marker written by the other account's run.
 *
 * The marker is the safety property. It must be one file for the machine, not
 * one per Windows profile. %PROGRAMDATA% is machine-wide, survives profile
 * changes, and is not roamed to another PC (which would be actively dangerous
 * here: a roamed marker is a marker about someone else's printer).
 *
 * Overridable with FONOLOGY_AGENT_DIR, which is how the test harness points a
 * whole agent at a scratch directory.
 */

function defaultStateDir(): string {
  // process.env.ProgramData is set on every Windows since Vista. The fallback
  // chain exists so that a developer on macOS/Linux can still run the agent
  // against the fake transport without special-casing anything.
  const programData = process.env.ProgramData ?? process.env.ALLUSERSPROFILE;
  if (programData) return path.join(programData, 'Fonology', 'PrintAgent');
  return path.join(os.homedir(), '.fonology-print-agent');
}

export const STATE_DIR = process.env.FONOLOGY_AGENT_DIR
  ? path.resolve(process.env.FONOLOGY_AGENT_DIR)
  : defaultStateDir();

export const CONFIG_FILE = path.join(STATE_DIR, 'agent.json');
export const INSTANCE_FILE = path.join(STATE_DIR, 'instance-id');
export const LOG_DIR = path.join(STATE_DIR, 'logs');
export const MARKER_DIR = path.join(STATE_DIR, 'markers');
export const SPOOL_DIR = path.join(STATE_DIR, 'spool');
export const FAKE_OUT_DIR = path.join(STATE_DIR, 'fake-printer');

/**
 * Create every directory the agent writes to, up front, at startup.
 *
 * Deliberately eager. The alternative — mkdir on first use — puts a directory
 * creation on the path of writing the crash marker, which is the one write
 * that must not fail for an avoidable reason.
 */
export function ensureStateDirs(): void {
  for (const dir of [STATE_DIR, LOG_DIR, MARKER_DIR, SPOOL_DIR, FAKE_OUT_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
