/**
 * GUI 管理模式使用的 AutoWSGR 后端来源。
 *
 * 此提交提供 GUI 所需的 OCR 与截图环境变量契约。
 * 安装和自动更新必须共用这里的来源，避免更新后退回不兼容版本。
 */
export const MANAGED_AUTOWSGR_COMMIT = (
  'b0f473fb1ec5318c2c4cff4795a804a3d2dd25bd'
);

export const MANAGED_AUTOWSGR_REQUIREMENT = (
  'https://github.com/ShiinaKuroko/AutoWSGR/archive/'
  + `${MANAGED_AUTOWSGR_COMMIT}.zip`
);
