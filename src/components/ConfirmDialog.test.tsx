// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ask, askForm, askText, ConfirmHost, fromText, tell } from './ConfirmDialog';
import { Modal } from './ui';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ''; });

const key = (k: string, shift = false) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true, cancelable: true })); });
const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === text)!;

describe('fromText', () => {
  it('splits the question from its detail and labels the action', () => {
    expect(fromText('Delete MDB-1? Its feeders go too.')).toEqual({ title: 'Delete MDB-1?', message: 'Its feeders go too.', confirmLabel: 'Delete', danger: true });
    expect(fromText('Bring VO-001 into the working BOQ?')).toMatchObject({ title: 'Bring VO-001 into the working BOQ?', message: undefined, confirmLabel: 'Bring', danger: false });
    expect(fromText('Export anyway')).toMatchObject({ title: 'Export anyway', danger: false });
  });
});

describe('ask() with <ConfirmHost>', () => {
  it('resolves with the answer, one question at a time', async () => {
    act(() => root.render(<ConfirmHost />));
    let a: Promise<boolean> | undefined, b: Promise<boolean> | undefined;
    act(() => { a = ask('Delete MDB-1? Its feeders go too.'); b = ask({ title: 'Issue IFC?', confirmLabel: 'Issue IFC' }); });
    expect(document.querySelectorAll('[role=alertdialog]')).toHaveLength(1);
    expect(document.body.textContent).toContain('Its feeders go too.');
    act(() => button('Delete').click());
    await expect(a).resolves.toBe(true);
    expect(document.body.textContent).toContain('Issue IFC?');
    key('Escape');
    await expect(b).resolves.toBe(false);
    expect(document.querySelector('[role=alertdialog]')).toBeNull();
  });

  it('starts on Cancel for a destructive action and on the action otherwise', () => {
    act(() => root.render(<ConfirmHost />));
    act(() => { void ask('Remove route A?'); });
    expect(document.activeElement?.textContent).toBe('Cancel');
    act(() => button('Cancel').click());
    act(() => { void tell('Saved'); });
    expect(document.activeElement?.textContent).toBe('OK');
    expect(button('Cancel')).toBeUndefined();
  });
});

describe('askForm() / askText() with <ConfirmHost>', () => {
  const type = (el: HTMLInputElement | HTMLTextAreaElement, v: string) => act(() => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  it('resolves the typed values, trimmed, from one form', async () => {
    act(() => root.render(<ConfirmHost />));
    let p: Promise<Record<string, string> | null> | undefined;
    act(() => { p = askForm({ title: 'New modification', fields: [{ key: 'title', label: 'Title', required: true }, { key: 'reason', label: 'Why?', multiline: true }] }); });
    expect(document.activeElement?.id).toContain('title'); // first field focused
    type(document.querySelector('input')!, '  Upsize cable ');
    type(document.querySelector('textarea')!, 'Comment 12');
    act(() => button('Save').click());
    await expect(p).resolves.toEqual({ title: 'Upsize cable', reason: 'Comment 12' });
  });
  it('blocks Save on an empty required field with a message in words, and Cancel / Escape give null', async () => {
    act(() => root.render(<ConfirmHost />));
    let p: Promise<string | null> | undefined;
    act(() => { p = askText('Rename', { label: 'Sheet title', required: true }); });
    act(() => button('Save').click());
    expect(document.querySelector('.field-error')?.textContent).toBe('Required');
    expect(document.querySelector('input')?.getAttribute('aria-invalid')).toBe('true');
    key('Escape');
    await expect(p).resolves.toBeNull();
    let q: Promise<string | null> | undefined;
    act(() => { q = askText('Link', { label: 'Link', initial: 'a' }); });
    act(() => button('Cancel').click());
    await expect(q).resolves.toBeNull();
  });
  it('offers a list as a choice', async () => {
    act(() => root.render(<ConfirmHost />));
    let p: Promise<string | null> | undefined;
    act(() => { p = askText('Apply a template', { label: 'Template', options: ['A3 standard', 'DEWA'] }); });
    const sel = document.querySelector('select')!;
    act(() => { sel.value = 'DEWA'; sel.dispatchEvent(new Event('change', { bubbles: true })); });
    act(() => button('Save').click());
    await expect(p).resolves.toBe('DEWA');
  });
});

describe('<Modal> focus', () => {
  it('returns focus to the opener when a field inside has autoFocus', () => {
    function Auto({ open }: { open: boolean }) {
      return <><button>Opener</button>{open && <Modal onClose={() => {}} label="Auto"><input aria-label="auto" autoFocus /></Modal>}</>;
    }
    act(() => root.render(<Auto open={false} />));
    button('Opener').focus();
    act(() => root.render(<Auto open />));
    expect(document.activeElement?.getAttribute('aria-label')).toBe('auto');
    act(() => root.render(<Auto open={false} />));
    expect(document.activeElement).toBe(button('Opener'));
  });

  function Harness({ open }: { open: boolean }) {
    return <>
      <button>Opener</button>
      {open && <Modal onClose={() => {}} label="Test"><input aria-label="first" /><button>Last</button></Modal>}
    </>;
  }
  it('moves focus in, keeps Tab inside, and returns focus to the opener', () => {
    act(() => root.render(<Harness open={false} />));
    button('Opener').focus();
    act(() => root.render(<Harness open />));
    const first = document.querySelector<HTMLInputElement>('input')!;
    expect(document.activeElement).toBe(first);
    button('Last').focus();
    key('Tab');
    expect(document.activeElement).toBe(first);
    key('Tab', true);
    expect(document.activeElement).toBe(button('Last'));
    act(() => root.render(<Harness open={false} />));
    expect(document.activeElement).toBe(button('Opener'));
  });
});
