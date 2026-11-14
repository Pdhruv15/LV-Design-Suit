import { CAD_COMMANDS, type CadCommand } from './cadCommands';

/** The command line's prompts, in the form `OFFSET  Specify offset distance or [Through/Erase/Layer] <0.30>:`: the
 * options in square brackets (the capital letters of each are its short key; a click works as typing it) and the
 * value Enter takes in angle brackets. */

export type PromptPart = { text: string } | { option: string; key: string };

/** The short key of an option: its capital letters (Through → T, eXit → X), else its first letter. */
export const optionKey = (option: string) => (option.replace(/[^A-Z]/g, '') || option.slice(0, 1)).toUpperCase();

/** A message cut into its text and the options in its last square brackets. */
export function promptParts(line: string): PromptPart[] {
  const m = /\[([A-Za-z]+(?:\/[A-Za-z]+)*)\]/.exec(line);
  if (!m) return [{ text: line }];
  const opts = m[1].split('/');
  const parts: PromptPart[] = [{ text: `${line.slice(0, m.index)}[` }];
  opts.forEach((o, i) => { if (i) parts.push({ text: '/' }); parts.push({ option: o, key: optionKey(o) }); });
  parts.push({ text: `]${line.slice(m.index + m[0].length)}` });
  return parts;
}

/** The options a prompt offers, with their keys. */
export const promptOptions = (line: string) => promptParts(line).flatMap((p) => ('option' in p ? [{ option: p.option, key: p.key }] : []));

/** Commands whose name or an alias starts with what is typed (shortest first, the alias typed first), for the list
 * shown above the command line while typing. */
export function matchingCommands(typed: string, max = 8): { alias: string; cmd: CadCommand }[] {
  const t = typed.trim().toUpperCase();
  if (!t || !/^[A-Z?][A-Z0-9 ]*$/.test(t)) return [];
  const out: { alias: string; cmd: CadCommand }[] = [];
  for (const cmd of CAD_COMMANDS) {
    const hit = cmd.aliases.filter((a) => a.startsWith(t)).sort((a, b) => a.length - b.length)[0];
    if (hit) out.push({ alias: hit, cmd });
  }
  return out.sort((a, b) => (a.alias === t ? -1 : b.alias === t ? 1 : a.alias.length - b.alias.length || a.alias.localeCompare(b.alias))).slice(0, max);
}

/** Commands that take a word after a space (VPSCALE 50, LAYOUT P, ZOOM E): Space types the space after them. */
const TAKES_ARG = new Set(['VPSCALE', 'LAYOUT', 'LO', 'VPORTS', 'VPALIGN']);
const NUM = '-?(?:\\d+\\.?\\d*|\\.\\d+)';
/** A whole number typed (".5" and "3." count), a whole point ("x,y", "@dx,dy", "@d<angle"), as the command line takes. */
export const isNumber = (s: string) => new RegExp(`^${NUM}$`).test(s.trim());
const isPoint = (s: string) => new RegExp(`^@?${NUM},${NUM}$|^@${NUM}<${NUM}$`).test(s.replace(/\s+/g, ''));
/** What Space does in the command line: `text` (TEXT contents, a leader's text, a name) always types a space; `value`
 * (TEXT height and rotation, where a word is taken as the text) ends an empty input or a number; `command` ends an empty
 * input or a whole word: a command, an option of the prompt, a number or a point. Anything else (a part of a point such
 * as "3," or "@3", a word that is no command, a command that takes a value after it) gets the space. */
export type SpaceMode = 'text' | 'value' | 'command';
export function spaceEnters(typed: string, mode: SpaceMode = 'command', options: { option: string; key: string }[] = []): boolean {
  const t = typed.trim().toUpperCase();
  if (mode === 'text') return false;
  if (!t) return true;
  if (/\s/.test(typed.trimStart())) return false;
  if (isNumber(t)) return true;
  if (mode === 'value') return false;
  if (isPoint(t)) return true;
  if (options.some((o) => o.key === t || o.option.toUpperCase() === t)) return true;
  if (TAKES_ARG.has(t)) return false;
  return CAD_COMMANDS.some((c) => c.aliases.includes(t)) && !CAD_COMMANDS.some((c) => c.aliases.some((a) => a.startsWith(`${t} `)));
}

/** The full command list (F1): each command once, its aliases and what it does. */
export const commandList = () => CAD_COMMANDS.map((c) => ({ aliases: c.aliases.join(' · '), desc: c.desc }));

/** A prompt in short form for the box at the cursor: "OFFSET  Specify offset distance or [Through/Erase/Layer]
 * <0.30>:" → "Specify offset distance". */
export function shortPrompt(line: string): string {
  const t = line.replace(/^Command:\s*/, '').replace(/^[A-Z0-9?]+ {2}/, '');
  return t.replace(/\s*(?:or\s*)?\[[^\]]*\].*$/, '').replace(/\s*<[^>]*>/, '').replace(/[:,]\s*$/, '').trim();
}
