import { builtinEngine } from './builtin';
import { openDssEngine, pandapowerEngine } from './external';
import type { CalcEngine } from './types';

/** External engines the comparison view can run against the built-in one. */
export const EXTERNAL_ENGINES: CalcEngine[] = [openDssEngine, pandapowerEngine];

export { builtinEngine };
