/**
 * 旧安装目录配置升级兼容测试入口。
 *
 * 使用隔离临时目录，不读取或修改真实用户数据。
 */
const {
  fs,
  temporaryDirectory,
} = require('./main-services/test-context');
const {
  testUserDataMigration,
} = require('./main-services/test-migration');

try {
  testUserDataMigration();
  console.log('legacy configuration upgrade compatibility test passed');
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
