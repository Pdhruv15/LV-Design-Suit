#!/usr/bin/env node
// What a built desktop package holds, read from its files; the app is not started. Fails when files the app never
// uses are back or a file it needs is missing. Only a real package shows what electron-builder does with the
// settings in package.json; tests/packageContents.test.ts checks the settings themselves.
//   node scripts/check-package.mjs "release/mac-arm64/LV Design Studio.app"
//   node scripts/check-package.mjs release/win-unpacked

import { closeSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CAD_ENGINE = 'electron/cad/lvds_cad_reader_bg.wasm';
const NEEDED = ['package.json', 'dist/index.html', 'dist/third-party-licences.md', 'dist-electron/exceljs.cjs', 'dist-electron/third-party-licences.md', 'electron/main.cjs', CAD_ENGINE];
// English only, as Chromium names it on each system. "en-US" is the one file Chromium needs on Windows and Linux;
// British English stays so a computer set to it keeps its 24-hour times and day-first dates.
export const MAC_LANGUAGES = ['en.lproj', 'en_GB.lproj'];
export const LOCALE_FILES = ['en-GB.pak', 'en-US.pak'];
// app.asar is 11.6 MB. Raise this when the app really grows; a jump means files came back.
export const MAX_ASAR_MB = 20;

/** Every file inside an app.asar, from its header. Chromium pickle: [4][header size][payload size][string length][JSON header] */
export function asarFiles(asar) {
  const fd = openSync(asar, 'r');
  try {
    const head = Buffer.alloc(16);
    readSync(fd, head, 0, 16, 0);
    const json = Buffer.alloc(head.readUInt32LE(12));
    readSync(fd, json, 0, json.length, 16);
    const files = [];
    const walk = (node, at) => {
      for (const [name, child] of Object.entries(node.files)) {
        if (child.files) walk(child, `${at}${name}/`);
        else files.push(`${at}${name}`);
      }
    };
    walk(JSON.parse(json.toString('utf-8')), '');
    return files;
  } finally { closeSync(fd); }
}

/** What is wrong with a package. languages: { [place]: { found: file names, expected: file names } } */
export function packageProblems({ files, asarMb, languages }) {
  const problems = [];
  const modules = files.filter((f) => f.split('/').includes('node_modules'));
  if (modules.length) problems.push(`node_modules is back in app.asar: ${modules.length} files, such as ${modules[0]}`);
  for (const f of files) if (f.endsWith('.wasm') && f !== CAD_ENGINE) problems.push(`A second CAD engine or other WebAssembly file is in app.asar: ${f}`);
  for (const f of NEEDED) if (!files.includes(f)) problems.push(`${f} is missing from app.asar`);
  if (asarMb > MAX_ASAR_MB) problems.push(`app.asar is ${asarMb.toFixed(1)} MB, above the ${MAX_ASAR_MB} MB limit`);
  for (const [place, { found, expected }] of Object.entries(languages)) {
    const wanted = [...expected].sort().join(', ');
    const got = [...found].sort().join(', ');
    if (got !== wanted) problems.push(`${place} should hold only ${wanted}, but holds ${found.length} files: ${got.slice(0, 200)}`);
  }
  return problems;
}

/** The language files of a package, by place. */
function languagesOf(target) {
  const lproj = (dir) => readdirSync(dir).filter((n) => n.endsWith('.lproj'));
  if (!target.endsWith('.app')) return { 'locales': { found: readdirSync(join(target, 'locales')), expected: LOCALE_FILES } };
  const framework = 'Contents/Frameworks/Electron Framework.framework/Versions/A/Resources';
  return Object.fromEntries(['Contents/Resources', framework].map((place) => [place, { found: lproj(join(target, place)), expected: MAC_LANGUAGES }]));
}

function main() {
  const target = process.argv[2];
  if (!target) { console.log('Usage: node scripts/check-package.mjs <built .app or unpacked folder>'); process.exit(2); }
  const asar = join(target, target.endsWith('.app') ? 'Contents/Resources' : 'resources', 'app.asar');
  const files = asarFiles(asar);
  const asarMb = statSync(asar).size / 1024 / 1024;
  const problems = packageProblems({ files, asarMb, languages: languagesOf(target) });
  for (const p of problems) console.log(`error: ${p}`);
  console.log(`Package ${target}: app.asar ${asarMb.toFixed(1)} MB, ${files.length} files, ${problems.length} problem${problems.length === 1 ? '' : 's'}.`);
  process.exit(problems.length ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
