const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const candidates = [
  process.env.AUTOWSGR_PYTHON,
  path.join(projectRoot, 'python', 'python.exe'),
  process.platform === 'win32' ? 'python' : 'python3',
].filter(Boolean);

const failures = [];
for (const python of candidates) {
  const result = spawnSync(
    python,
    [
      '-m',
      'unittest',
      'discover',
      '-s',
      'tools',
      '-p',
      'test_ocr_log_analyzer.py',
    ],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      windowsHide: true,
    },
  );
  if (result.status === 0) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    console.log('OCR log analyzer tests passed');
    process.exit(0);
  }
  failures.push(
    `${python}:\n${result.stdout || ''}${result.stderr || result.error || ''}`,
  );
}

throw new Error(`OCR log analyzer tests failed:\n${failures.join('\n')}`);
