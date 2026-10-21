import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from './ui';

export type Command = {
  id: string;
  label: string;
  /** Shown dimmed after the label, and searched too (a board's name, a sheet's title…). */
  hint?: string;
  group: string;
  /** Its keyboard shortcut, for display. */
  keys?: string;
  run: () => void;
};

const MAX = 60;

/** Every word typed must appear in the label or hint; label matches rank first, label prefixes before that. */
export function filterCommands(commands: Command[], q: string): Command[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return commands.slice(0, MAX);
  const scored: { c: Command; score: number; i: number }[] = [];
  commands.forEach((c, i) => {
    const label = c.label.toLowerCase();
    const all = `${label} ${(c.hint ?? '').toLowerCase()} ${c.group.toLowerCase()}`;
    if (!words.every((w) => all.includes(w))) return;
    const score = (label.startsWith(words[0]) ? 0 : label.includes(words[0]) ? 1 : 2) + (words.every((w) => label.includes(w)) ? 0 : 1);
    scored.push({ c, score, i });
  });
  return scored.sort((a, b) => a.score - b.score || a.i - b.i).slice(0, MAX).map((x) => x.c);
}

/** ⌘K: type to find a board, a sheet, a page or an action, Enter to go. */
export default function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [at, setAt] = useState(0);
  const list = useMemo(() => filterCommands(commands, q), [commands, q]);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => setAt(0), [q]);
  useEffect(() => { listRef.current?.querySelector(`[data-i="${at}"]`)?.scrollIntoView({ block: 'nearest' }); }, [at]);
  const run = (c: Command | undefined) => { if (!c) return; onClose(); c.run(); };
  return (
    <Modal onClose={onClose} className="cmdk" backdropClassName="cmdk-backdrop" label="Command palette">
      <input autoFocus className="cmdk-input" placeholder="Go to a board, sheet or page, or run a command…" value={q} aria-label="Search commands"
        role="combobox" aria-expanded aria-controls="cmdk-list" aria-activedescendant={list[at] ? `cmdk-${at}` : undefined}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setAt((i) => Math.min(list.length - 1, i + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((i) => Math.max(0, i - 1)); }
          else if (e.key === 'Enter') { e.preventDefault(); run(list[at]); }
          else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        }} />
      <div className="cmdk-list" id="cmdk-list" role="listbox" ref={listRef}>
        {!list.length && <p className="m cmdk-empty">Nothing matches “{q}”.</p>}
        {list.map((c, i) => (
          <div key={c.id}>
            {(i === 0 || list[i - 1].group !== c.group) && <div className="cmdk-group">{c.group}</div>}
            <button id={`cmdk-${i}`} data-i={i} role="option" aria-selected={i === at} className={`cmdk-item${i === at ? ' on' : ''}`}
              onMouseMove={() => i !== at && setAt(i)} onClick={() => run(c)}>
              <span className="cmdk-label">{c.label}</span>
              {c.hint && <span className="m cmdk-hint">{c.hint}</span>}
              {c.keys && <kbd>{c.keys}</kbd>}
            </button>
          </div>
        ))}
      </div>
      <div className="cmdk-foot m"><kbd>↑</kbd><kbd>↓</kbd> move · <kbd>Enter</kbd> go · <kbd>Esc</kbd> close · <kbd>?</kbd> all shortcuts</div>
    </Modal>
  );
}

const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

export const SHORTCUTS: [string, [string, string][]][] = [
  ['Anywhere', [
    [`${mod}K`, 'Command palette: boards, sheets, pages, commands'],
    ['?', 'This list of shortcuts'],
    ['F5', 'Run the network studies'],
    [`${mod}S`, 'Save'], [`⇧${mod}S`, 'Save as'],
    [`${mod}Z`, 'Undo'], [`⇧${mod}Z / ${mod}Y`, 'Redo'],
    [`${mod}F1`, 'Collapse / expand the ribbon']
  ]],
  ['Design (SLD)', [
    [`${mod}1`, 'System diagram'], [`${mod}2`, 'Board diagram'], [`${mod}3`, 'Earthing'], [`${mod}4`, 'Riser'],
    ['[  ]', 'Previous / next drawing sheet'],
    ['V', 'Select tool'], ['H', 'Pan tool'],
    [`${mod}C / ${mod}V`, 'Copy / paste the selected board'],
    ['Delete', 'Delete the selected board or circuit'],
    ['F2', 'Edit the focused board or circuit']
  ]],
  ['Panel tree', [
    ['Tab / ⇧Tab', 'Indent / outdent (change what supplies it)'],
    ['Alt+↑ / Alt+↓', 'Move up / down']
  ]],
  ['Drawing sheet', [
    ['F', 'Fit the sheet to the window'], [`${mod}+scroll`, 'Zoom'],
    ['M', 'Show / hide the markup tools'],
    ['V C B L A T O', 'Select, Cloud, Box, Line, Arrow, Note, Callout'],
    ['P R', 'Panel cloud, Panel arrow (system sheets)'],
    ['Delete', 'Remove the selected markup'], ['Esc', 'Back to Select']
  ]]
];

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose} className="modal kbd-help" label="Keyboard shortcuts">
      <h3>Keyboard shortcuts</h3>
      <div className="kbd-cols">
        {SHORTCUTS.map(([group, rows]) => (
          <section key={group}>
            <h4>{group}</h4>
            <dl>{rows.map(([k, what]) => <div key={k + what}><dt><kbd>{k}</kbd></dt><dd>{what}</dd></div>)}</dl>
          </section>
        ))}
      </div>
      <div className="modal-actions"><span className="sp" /><button className="chip" onClick={onClose}>Close</button></div>
    </Modal>
  );
}
