/**
 * Keep Renderer controllers independent from DOM and global IPC access.
 * Views own browser UI details; adapters own window.electronBridge.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const controllerRoot = path.join(root, 'src', 'controller');
const forbidden = [
  {
    name: 'DOM access',
    pattern: /\bdocument\s*\./,
  },
  {
    name: 'global Electron bridge',
    pattern: /\bwindow\s*\.\s*electronBridge\b/,
  },
  {
    name: 'direct browser storage',
    pattern: /\blocalStorage\s*\./,
  },
  {
    name: 'browser event ownership',
    pattern: /\bwindow\s*\.\s*(?:addEventListener|matchMedia)\b/,
  },
  {
    name: 'DOM implementation type',
    pattern: /\b(?:ResizeObserver|HTMLElement|HTMLButtonElement|HTMLInputElement|HTMLSelectElement)\b/,
  },
];

function listTypeScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) return listTypeScriptFiles(target);
      return entry.isFile() && entry.name.endsWith('.ts')
        ? [target]
        : [];
    });
}

const files = listTypeScriptFiles(controllerRoot);
const violations = [];
for (const file of files) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const rule of forbidden) {
      if (rule.pattern.test(line)) {
        violations.push(
          `${path.relative(root, file)}:${index + 1} `
          + `[${rule.name}] ${line.trim()}`,
        );
      }
    }
  }
}

assert.deepEqual(
  violations,
  [],
  `Controller boundary violations:\n${violations.join('\n')}`,
);

const navigationSource = fs.readFileSync(
  path.join(controllerRoot, 'app', 'NavigationController.ts'),
  'utf8',
);
assert.doesNotMatch(
  navigationSource,
  /\b(?:PlanController|FleetPlannerController)\b/,
  'NavigationController must depend on navigation capabilities, not concrete plan controllers',
);

console.log(`controller boundary tests passed (${files.length} files)`);
