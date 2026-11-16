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
  expeditionIntervalToMilliseconds,
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

assert.equal(expeditionIntervalToMilliseconds(15), 900_000);
assert.equal(expeditionIntervalToMilliseconds(15.2), 912_000, '小数分钟换算毫秒必须取整');
assert.equal(expeditionIntervalToMilliseconds(0.5), 30_000, '0.5 分钟等于 30 秒');
assert.equal(expeditionIntervalToMilliseconds(1440), 86_400_000, '24 小时');
assert.equal(expeditionIntervalToMilliseconds(9999), 86_400_000, '超上限先归一化再换算');

assert.equal(formatExpeditionCountdown(30), '00:30');
assert.equal(formatExpeditionCountdown(600), '10:00');
assert.equal(formatExpeditionCountdown(3599), '59:59');
assert.equal(formatExpeditionCountdown(3600), '1:00:00', '达到 1 小时必须显示小时位');
assert.equal(formatExpeditionCountdown(9000), '2:30:00');
assert.equal(formatExpeditionCountdown(-1), '00:00');

// ExpeditionTimer.start() 必须在注册 1 秒 tick 之前先发布一次倒计时，
// 否则界面上的剩余时间会从「间隔 - 1 秒」开始，看起来少了一秒。
const timerBundle = await esbuild.build({
  entryPoints: ['src/model/scheduler/ExpeditionTimer.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const timerModuleUrl = `data:text/javascript;base64,${
  Buffer.from(timerBundle.outputFiles[0].text).toString('base64')
}`;
const { ExpeditionTimer } = await import(timerModuleUrl);

const ticks = [];
const timer = new ExpeditionTimer(912_000, {
  onTick: (remainingSeconds) => ticks.push(remainingSeconds),
  onTrigger: () => {},
});
timer.start();
assert.deepEqual(ticks, [912], 'start() 必须立即发布完整间隔的倒计时');
timer.stop();

const halfMinuteTicks = [];
const halfMinuteTimer = new ExpeditionTimer(30_000, {
  onTick: (remainingSeconds) => halfMinuteTicks.push(remainingSeconds),
  onTrigger: () => {},
});
halfMinuteTimer.start();
assert.deepEqual(halfMinuteTicks, [30], '30 秒间隔的首次倒计时为 30 秒');
halfMinuteTimer.stop();

console.log('远征间隔与倒计时领域测试通过');
