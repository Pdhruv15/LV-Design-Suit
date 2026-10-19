import { main } from './cli';

// Entry of the bundled `lvds` command (dist-cli/lvds.mjs). -1: a server keeps running.
main(process.argv.slice(2), __APP_VERSION__).then((code) => { if (code >= 0) process.exitCode = code; });
