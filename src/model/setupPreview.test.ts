import { afterEach, describe, expect, it } from 'vitest';
import { applyDatabase, EMPTY_DATABASE } from '../database/database';
import { DEFAULT_PREFS, type Preferences } from './profile';
import { defaultsPreview } from './setupPreview';

afterEach(() => applyDatabase(EMPTY_DATABASE));
const row = (rows: ReturnType<typeof defaultsPreview>, label: string) => rows.find((r) => r.label.startsWith(label))!;

describe('defaults a new project starts with', () => {
  it('are the built-in ones, labelled so, when nothing is set', () => {
    const rows = defaultsPreview(EMPTY_DATABASE, DEFAULT_PREFS);
    expect(row(rows, 'System voltage')).toEqual({ label: 'System voltage (V)', value: '415', source: 'built-in' });
    expect(row(rows, 'Company').value).toBe('—');
    expect(rows.every((r) => r.source === 'built-in')).toBe(true);
  });

  it('say when a value comes from your profile', () => {
    const prefs: Preferences = {
      profile: { name: 'Asha', company: 'ABC Eng', checkedBy: 'R. Kumar' },
      defaults: { voltageV: 400, ambientC: 50, sheet: 'A1', autoRun: true },
      app: { autosaveMin: 5 }
    };
    const rows = defaultsPreview(EMPTY_DATABASE, prefs);
    expect(row(rows, 'System voltage')).toMatchObject({ value: '400', source: 'your profile' });
    expect(row(rows, 'Ambient')).toMatchObject({ value: '50', source: 'your profile' });
    expect(row(rows, 'Drawing sheet')).toMatchObject({ value: 'A1', source: 'your profile' });
    expect(row(rows, 'Company')).toMatchObject({ value: 'ABC Eng', source: 'your profile' });
    expect(row(rows, 'Drawn by')).toMatchObject({ value: 'Asha', source: 'your profile' });
    expect(row(rows, 'Calculations run')).toMatchObject({ value: 'yes', source: 'your profile' });
    expect(row(rows, 'Frequency').source).toBe('built-in');
  });
});
