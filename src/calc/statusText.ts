import type { Status } from './electrical';

/** How a calculated check is worded everywhere (screens, schedules,
 * reports): it is the app's own calculation against the limits set in the
 * project, not an engineering approval or a statement of compliance —
 * that stays with the engineer (Checked / Approved on the sheets). */
export const STATUS_TEXT: Record<Status, string> = { ok: 'Within limit', warn: 'Check', bad: 'Exceeds limit' };
export const statusText = (s: Status) => STATUS_TEXT[s];
/** A status cell back to its key (report tables colour it). */
export const statusOfText = (c: unknown): Status | undefined => (c === STATUS_TEXT.ok ? 'ok' : c === STATUS_TEXT.warn ? 'warn' : c === STATUS_TEXT.bad ? 'bad' : undefined);
/** Under results and on reports. */
export const CALC_DISCLAIMER = 'Calculated checks against the project limits — engineering review and approval are separate.';
