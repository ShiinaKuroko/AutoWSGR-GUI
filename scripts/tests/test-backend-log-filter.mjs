import assert from 'node:assert/strict';

const { isBackendTracebackBoundary } = await import(
  '../../dist/electron/services/BackendService.js',
);

assert.equal(
  isBackendTracebackBoundary('Traceback (most recent call last):'),
  true,
);
assert.equal(
  isBackendTracebackBoundary(
    'During handling of the above exception, another exception occurred:',
  ),
  true,
);
assert.equal(isBackendTracebackBoundary('File "navigate.py", line 174'), false);
assert.equal(isBackendTracebackBoundary('normal backend log'), false);

console.log('backend log filter tests passed');
