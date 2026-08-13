/**
 * The agent version reported on every heartbeat.
 *
 * Hardcoded rather than read from package.json at runtime. The agent is
 * installed as a folder of compiled JS on a shop PC, and `package.json` is not
 * guaranteed to sit anywhere predictable relative to `dist/` once an installer
 * has moved things around. A constant cannot go missing.
 *
 * Keep it in step with package.json by hand — there is exactly one of these.
 */
export const AGENT_VERSION = '0.1.0';
