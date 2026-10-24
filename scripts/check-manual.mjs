import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const manualRoot = path.join(root, 'docs', 'manual');
const read = (file) => fs.readFileSync(file, 'utf8');
const fail = (message) => { throw new Error(`Manual check failed: ${message}`); };
const exists = (file, label) => {
  if (!fs.existsSync(file)) fail(`${label} does not exist: ${path.relative(root, file)}`);
};

function records(text, marker) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let current;
  for (const line of lines) {
    const start = line.match(new RegExp(`^  - ${marker}: (\\S+)$`));
    if (start) {
      current = { [marker]: start[1], lines: [] };
      out.push(current);
    } else if (current) {
      if (/^ {2}- \S/.test(line)) current = undefined;
      else current.lines.push(line);
    }
  }
  return out;
}

function scalar(lines, key) {
  const match = lines.find((line) => line.match(new RegExp(`^    ${key}: `)));
  return match?.replace(new RegExp(`^    ${key}:\\s*`), '').replace(/^"|"$/g, '');
}

const indexFile = path.join(manualRoot, 'manual-index.yml');
const mapFile = path.join(manualRoot, 'component-map.yml');
const visualsFile = path.join(manualRoot, 'visuals.json');
exists(indexFile, 'Manual index');
exists(mapFile, 'Component map');
exists(visualsFile, 'Visual manifest');

const visuals = JSON.parse(read(visualsFile));
if (visuals.schemaVersion !== 1 || !Array.isArray(visuals.shots) || !visuals.shots.length) fail('visuals.json has no supported shots');
const shotIds = visuals.shots.map((shot) => shot.id);
if (new Set(shotIds).size !== shotIds.length) fail('visuals.json has duplicate shot IDs');
for (const shot of visuals.shots) {
  if (!shot.module || !shot.image || !shot.metadata || !shot.readyTarget) fail(`${shot.id ?? 'visual'} is incomplete`);
  exists(path.join(root, shot.image), `${shot.id} image`);
  const metadataFile = path.join(root, shot.metadata);
  exists(metadataFile, `${shot.id} metadata`);
  const numbers = shot.callouts?.map((callout) => callout.number) ?? [];
  if (!numbers.length || new Set(numbers).size !== numbers.length) fail(`${shot.id} has missing or duplicate callout numbers`);
  const metadata = JSON.parse(read(metadataFile));
  if (metadata.shot !== shot.id) fail(`${shot.id} metadata belongs to ${metadata.shot ?? 'an unknown shot'}`);
  const captured = new Map(metadata.callouts?.map((callout) => [callout.number, callout]) ?? []);
  for (const callout of shot.callouts) {
    const actual = captured.get(callout.number);
    if (!actual || actual.target !== callout.target) fail(`${shot.id} callout ${callout.number} needs a fresh capture`);
    if (![actual.point?.x, actual.point?.y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
      fail(`${shot.id} callout ${callout.number} is outside the captured image`);
    }
  }
}

const modules = records(read(indexFile), 'id');
if (!modules.length) fail('manual-index.yml has no modules');

const ids = modules.map((module) => module.id);
if (new Set(ids).size !== ids.length) fail('manual-index.yml has duplicate module IDs');

const orders = modules.map((module) => Number(scalar(module.lines, 'order')));
if (orders.some((order) => !Number.isFinite(order))) fail('every module needs a numeric order');
if (new Set(orders).size !== orders.length) fail('manual-index.yml has duplicate module order values');

for (const module of modules) {
  if (!/^M\d{2}$/.test(module.id)) fail(`invalid module ID ${module.id}`);
  const source = scalar(module.lines, 'source');
  const metadata = scalar(module.lines, 'metadata');
  const visualPdf = scalar(module.lines, 'visual_pdf');
  if (!source || !metadata) fail(`${module.id} needs source and metadata paths`);

  const sourceFile = path.join(manualRoot, source);
  const metadataFile = path.join(manualRoot, metadata);
  exists(sourceFile, `${module.id} source`);
  exists(metadataFile, `${module.id} metadata`);
  if (visualPdf) exists(path.join(root, visualPdf), `${module.id} visual PDF`);

  const metadataText = read(metadataFile);
  const declaredId = metadataText.match(/^id:\s*(\S+)$/m)?.[1];
  const prefix = metadataText.match(/^section_prefix:\s*(\S+)$/m)?.[1];
  if (declaredId !== module.id) fail(`${metadata} declares ${declaredId ?? 'no ID'}, expected ${module.id}`);
  if (!prefix) fail(`${metadata} has no section_prefix`);

  const sectionIds = [...metadataText.matchAll(/^ {2}- id:\s*(\S+)$/gm)].map((match) => match[1]);
  const anchors = [...read(sourceFile).matchAll(/^<a id="([^"]+)"><\/a>$/gm)].map((match) => match[1]);
  if (!sectionIds.length) fail(`${metadata} has no sections`);
  if (new Set(sectionIds).size !== sectionIds.length) fail(`${metadata} has duplicate section IDs`);
  for (let i = 0; i < sectionIds.length; i += 1) {
    const id = sectionIds[i];
    const match = id.match(new RegExp(`^${prefix}-(\\d{3})$`));
    if (!match) fail(`invalid section ID ${id} in ${metadata}`);
    if (i && Number(match[1]) <= Number(sectionIds[i - 1].slice(prefix.length + 1))) {
      fail(`section IDs are not increasing in ${metadata}`);
    }
  }
  const missing = sectionIds.filter((id) => !anchors.includes(id));
  const extra = anchors.filter((id) => !sectionIds.includes(id));
  if (missing.length || extra.length) {
    fail(`${module.id} section mismatch; missing anchors: ${missing.join(', ') || 'none'}; extra anchors: ${extra.join(', ') || 'none'}`);
  }
}

const mappings = records(read(mapFile), 'module');
const mappedIds = mappings.map((mapping) => mapping.module);
for (const id of ids) if (!mappedIds.includes(id)) fail(`${id} has no component mapping`);
for (const id of mappedIds) if (!ids.includes(id)) fail(`component-map.yml references unknown module ${id}`);
for (const shot of visuals.shots) if (!ids.includes(shot.module)) fail(`${shot.id} references unknown module ${shot.module}`);

for (const mapping of mappings) {
  let inFiles = false;
  const files = [];
  for (const line of mapping.lines) {
    if (line === '    source_files:') { inFiles = true; continue; }
    if (inFiles && /^ {4}\S/.test(line)) inFiles = false;
    const item = inFiles && line.match(/^ {6}- (.+)$/);
    if (item) files.push(item[1]);
  }
  if (!files.length) fail(`${mapping.module} has no mapped source files`);
  for (const file of files) exists(path.join(root, file), `${mapping.module} mapped source`);
}

console.log(`Manual structure OK: ${modules.length} modules, ${mappings.length} component mappings.`);

