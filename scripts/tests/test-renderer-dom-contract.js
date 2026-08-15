const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');
const htmlPath = path.join(projectRoot, 'src', 'view', 'index.html');
const viewRoot = path.join(projectRoot, 'src', 'view');

const intentionallyUnmountedIds = new Map([
  ['btn-add-to-group', 'legacy plan action without a mounted control'],
  ['btn-create-template', 'template library UI is intentionally not mounted'],
  ['btn-import-template', 'template library UI is intentionally not mounted'],
  ['save-success-notice', 'created on demand by DialogHelper'],
  ['template-library-card', 'template library UI is intentionally not mounted'],
  ['template-library-items', 'template library UI is intentionally not mounted'],
]);

function collectFiles(directory, extension) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(fullPath, extension);
    return entry.isFile() && entry.name.endsWith(extension) ? [fullPath] : [];
  });
}

function collectMatches(content, pattern) {
  return Array.from(content.matchAll(pattern), match => match[1]);
}

const html = fs.readFileSync(htmlPath, 'utf8');
const updateChannelControl = html.match(
  /<input\b(?=[^>]*\btype=["']checkbox["'])(?=[^>]*\bid=["']cfg-allow-test-updates["'])[^>]*>/,
);
if (!updateChannelControl) {
  throw new Error('Update channel control must be a checkbox');
}
const updateSectionIndex = html.indexOf('<h3>更新与界面</h3>');
const updateChannelIndex = html.indexOf('<strong>更新渠道</strong>');
const updateModeIndex = html.indexOf('<strong>更新模式</strong>');
if (
  updateSectionIndex < 0
  || updateChannelIndex < updateSectionIndex
  || updateModeIndex < updateChannelIndex
) {
  throw new Error(
    'Update channel control must be above update mode in the update section',
  );
}
if (
  !html.includes(
    '<span>关闭时只接受稳定版推送，开启优先接受预览版推送。</span>',
  )
) {
  throw new Error('Update channel description does not match the UI contract');
}
const updateChannelHintIndex = html.indexOf(
  '<span class="config-update-channel-hint">'
  + '开启预览版更新渠道，将在保存设置后生效</span>',
);
const updateChannelControlIndex = html.indexOf(
  'id="cfg-allow-test-updates"',
);
if (
  updateChannelHintIndex < updateChannelIndex
  || updateChannelControlIndex < updateChannelHintIndex
) {
  throw new Error('Update channel save hint must be left of the switch');
}
const htmlIds = collectMatches(
  html,
  /\bid\s*=\s*["']([^"']+)["']/g,
);
const duplicateIds = htmlIds.filter(
  (id, index) => htmlIds.indexOf(id) !== index,
);
if (duplicateIds.length > 0) {
  throw new Error(
    `Duplicate renderer DOM ids: ${Array.from(new Set(duplicateIds)).join(', ')}`,
  );
}

const referencedIds = new Map();
const referencePatterns = [
  /\bgetElementById\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\b(?:element|requiredElement)\s*(?:<[^>]+>)?\s*\(\s*["']([^"']+)["']/g,
  /\bquerySelector(?:All)?\s*(?:<[^>]+>)?\s*\(\s*["']#([A-Za-z][\w:.-]*)["']/g,
];

for (const filePath of collectFiles(viewRoot, '.ts')) {
  const content = fs.readFileSync(filePath, 'utf8');
  for (const pattern of referencePatterns) {
    for (const id of collectMatches(content, pattern)) {
      const locations = referencedIds.get(id) ?? [];
      locations.push(path.relative(projectRoot, filePath));
      referencedIds.set(id, locations);
    }
  }
}

const htmlIdSet = new Set(htmlIds);
const missingIds = Array.from(referencedIds)
  .filter(([id]) => !htmlIdSet.has(id) && !intentionallyUnmountedIds.has(id))
  .map(([id, files]) => `${id} (${Array.from(new Set(files)).join(', ')})`);
if (missingIds.length > 0) {
  throw new Error(`Renderer DOM references are not mounted:\n${missingIds.join('\n')}`);
}

const staleAllowlist = Array.from(intentionallyUnmountedIds)
  .filter(([id]) => htmlIdSet.has(id) || !referencedIds.has(id))
  .map(([id, reason]) => `${id} (${reason})`);
if (staleAllowlist.length > 0) {
  throw new Error(`Stale renderer DOM allowlist entries:\n${staleAllowlist.join('\n')}`);
}

console.log(
  `renderer DOM contract passed (${htmlIds.length} ids, `
  + `${referencedIds.size} static references)`,
);
