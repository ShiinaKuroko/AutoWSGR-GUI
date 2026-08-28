import assert from 'node:assert/strict';
import esbuild from 'esbuild';

const result = await esbuild.build({
  entryPoints: ['src/utils/Logger.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(
  result.outputFiles[0].text,
).toString('base64')}`;
const { Logger } = await import(moduleUrl);

const writes = [];
const originalLog = console.log;
console.log = (...args) => writes.push(args);
try {
  const forwarded = '[Combat] 战果: MVP=1 评价=SS 节点: A';
  Logger.logLevel('info', forwarded, 'combat');
  Logger.logLevel('info', forwarded, 'GUI');
  assert.equal(writes.length, 1, 'WebSocket/stdout forwarding should be logged once');

  const sameChannel = '[Combat] 战果: MVP=2 评价=S 节点: B';
  Logger.logLevel('info', sameChannel, 'GUI');
  Logger.logLevel('info', sameChannel, 'GUI');
  assert.equal(writes.length, 3, 'same-channel messages must remain independent');

  const reverseOrder = '[Combat] 获得舰船: 测试舰';
  Logger.logLevel('info', reverseOrder, 'GUI');
  Logger.logLevel('info', reverseOrder, 'combat');
  assert.equal(writes.length, 4, 'deduplication must not depend on arrival order');
} finally {
  console.log = originalLog;
}

console.log('logger dedup tests passed');
