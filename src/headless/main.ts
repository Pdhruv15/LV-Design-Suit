import { DOMParser } from '@xmldom/xmldom';
import { main } from './cli';

// The DXF export parses SVG markup with DOMParser (src/diagram/exportSvg.ts), which Node does not have: the same
// stand-in as the app's DXF tests.
if (typeof globalThis.DOMParser === 'undefined') (globalThis as { DOMParser?: unknown }).DOMParser = DOMParser;

// Entry of the bundled `lvds` command (dist-cli/lvds.mjs). -1: a server keeps running.
main(process.argv.slice(2), __APP_VERSION__).then((code) => { if (code >= 0) process.exitCode = code; });
