import type { StudyReportKind, StudyReportSetup } from '../types';

/** Ready-made report types: which sections a design report has. Choosing one
 * sets the studies and parts below; the user can still tick sections on or
 * off afterwards (the report is then "Custom"). */

export type ReportType = 'full' | 'calc' | 'load' | 'cable' | 'sc' | 'authority';

export interface ReportTypeInfo {
  key: ReportType;
  label: string;
  description: string;
  studies: StudyReportKind[];
  designBasis: boolean;
  resultsSummary: boolean;
  sld: boolean;
}

export const REPORT_TYPES: ReportTypeInfo[] = [
  { key: 'full', label: 'Full design report', description: 'Every section: design basis, all calculations, results and compliance, appendices',
    studies: ['load', 'sizing', 'dist', 'cable', 'lf', 'sc', 'disc', 'earth', 'phase', 'busbar', 'pfc', 'schedules'], designBasis: true, resultsSummary: true, sld: true },
  { key: 'calc', label: 'Calculation report', description: 'The calculations in detail, without the executive summary and design basis',
    studies: ['load', 'sizing', 'cable', 'lf', 'sc', 'disc', 'earth'], designBasis: false, resultsSummary: true, sld: false },
  { key: 'load', label: 'Load assessment report', description: 'Connected load, maximum demand, transformer and generator sizing, phase balance',
    studies: ['load', 'sizing', 'phase'], designBasis: true, resultsSummary: false, sld: false },
  { key: 'cable', label: 'Cable sizing report', description: 'Cable and breaker sizing and voltage drop, with the cable schedule',
    studies: ['cable', 'lf', 'schedules'], designBasis: false, resultsSummary: true, sld: true },
  { key: 'sc', label: 'Short-circuit report', description: 'Fault levels, breaking capacity and discrimination',
    studies: ['sc', 'disc'], designBasis: false, resultsSummary: false, sld: true },
  { key: 'authority', label: 'Authority submission report', description: 'Concise: design basis, load, sizing, distribution, short circuit, earthing and the compliance summary',
    studies: ['load', 'sizing', 'dist', 'sc', 'earth'], designBasis: true, resultsSummary: true, sld: true }
];

export const reportTypeInfo = (k: ReportType) => REPORT_TYPES.find((t) => t.key === k)!;

/** The setup patch that applies a report type. */
export const applyReportType = (k: ReportType): Partial<StudyReportSetup> => {
  const t = reportTypeInfo(k);
  return { reportType: k, studies: [...t.studies], designBasis: t.designBasis, resultsSummary: t.resultsSummary, sld: t.sld };
};

/** The type the current choice still matches, or undefined (custom). */
export function matchingType(s: StudyReportSetup): ReportType | undefined {
  const t = s.reportType && reportTypeInfo(s.reportType);
  if (!t) return undefined;
  const same = t.studies.length === s.studies.length && t.studies.every((k) => s.studies.includes(k))
    && t.designBasis === (s.designBasis !== false) && t.resultsSummary === (s.resultsSummary !== false);
  return same ? t.key : undefined;
}
