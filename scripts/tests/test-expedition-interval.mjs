/**
 * 远征检查间隔与倒计时的领域测试。
 *
 * 间隔允许 0.5～1440 分钟的小数配置；倒计时达到 1 小时后切换为 H:MM:SS。
 */
import assert from 'node:assert/strict';
import esbuild from 'esbuild';

const result = await esbuild.build({
  entryPoints: ['src/shared/expedition.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const moduleUrl = `data:text/javascript;base64,${
  Buffer.from(result.outputFiles[0].text).toString('base64')
}`;
const {
  DEFAULT_EXPEDITION_INTERVAL_MINUTES,
  MIN_EXPEDITION_INTERVAL_MINUTES,
  MAX_EXPEDITION_INTERVAL_MINUTES,
  normalizeExpeditionInterval,
  formatExpeditionCountdown,
} = await import(moduleUrl);

assert.equal(DEFAULT_EXPEDITION_INTERVAL_MINUTES, 15);
assert.equal(MIN_EXPEDITION_INTERVAL_MINUTES, 0.5);
assert.equal(MAX_EXPEDITION_INTERVAL_MINUTES, 1440);

assert.equal(normalizeExpeditionInterval(15), 15);
assert.equal(normalizeExpeditionInterval(120), 120, '区间内的旧配置必须保持原值');
assert.equal(normalizeExpeditionInterval(0.5), 0.5, '0.5 分钟（30 秒）必须保留');
assert.equal(normalizeExpeditionInterval(2.5), 2.5, '小数间隔不能被取整');
assert.equal(normalizeExpeditionInterval(1440), 1440, '24 小时是上限');
assert.equal(normalizeExpeditionInterval(9999), 1440, '超过上限必须收敛到 1440');
assert.equal(normalizeExpeditionInterval(0), 15, '非法值回退到默认 15 分钟');
assert.equal(normalizeExpeditionInterval(Number.NaN), 15);
assert.equal(normalizeExpeditionInterval(-3), 15);

assert.equal(formatExpeditionCountdown(30), '00:30');
assert.equal(formatExpeditionCountdown(600), '10:00');
assert.equal(formatExpeditionCountdown(3599), '59:59');
assert.equal(formatExpeditionCountdown(3600), '1:00:00', '达到 1 小时必须显示小时位');
assert.equal(formatExpeditionCountdown(9000), '2:30:00');
assert.equal(formatExpeditionCountdown(-1), '00:00');

console.log('远征间隔与倒计时领域测试通过');
