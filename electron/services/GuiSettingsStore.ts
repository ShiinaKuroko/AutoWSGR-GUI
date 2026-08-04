/**
 * 读取并浅合并写入 gui_settings.json。
 */
import * as fs from 'fs';

/** 管理唯一 GUI JSON 设置文件的读取和浅合并写入。 */
export class GuiSettingsStore {
  constructor(private readonly getFilePath: () => string) {}

  /** 返回当前 GUI 设置文件路径。 */
  filePath(): string {
    return this.getFilePath();
  }

  /** 读取设置；不存在或无法解析时保持原有空对象回退。 */
  read(): Record<string, unknown> {
    try {
      const filePath = this.filePath();
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      }
    } catch {
      // 文件缺失或无效时返回空设置。
    }
    return {};
  }

  /** 浅合并 patch 后覆盖写回唯一设置文件。 */
  write(patch: Record<string, unknown>): void {
    const current = this.read();
    Object.assign(current, patch);
    fs.writeFileSync(
      this.filePath(),
      JSON.stringify(current, null, 2),
      'utf-8',
    );
  }
}
