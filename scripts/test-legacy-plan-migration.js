/**
 * 旧计划自动升级迁移测试入口。
 *
 * 复用主进程迁移测试，仅在系统临时目录中读写。
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
  console.log('legacy plan migration test passed');
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
