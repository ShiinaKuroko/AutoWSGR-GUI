/** 编排远征收取、奖励领取等常用自动化操作。 */
import type { ApiResponse } from '../../types/api.js';
import { ApiClient } from '../../model/ApiClient';
import { MainView } from '../../view/main/MainView';
import { Logger } from '../../utils/Logger';

export class OperationsController {
  constructor(
    private readonly api: ApiClient,
    private readonly mainView: MainView,
    private readonly logger: typeof Logger,
  ) {}

  bindOpsActions(): void {
    const wrap = (btnId: string, label: string, action: () => Promise<ApiResponse>) => {
      document.getElementById(btnId)?.addEventListener('click', async () => {
        const btn = document.getElementById(btnId) as HTMLButtonElement;
        btn.disabled = true;
        this.mainView.setOpsStatus(`${label}中…`);
        try {
          const res = await action();
          if (res.success) { this.logger.info(`${label}完成`); this.mainView.setOpsStatus(`${label}完成`); }
          else { Logger.warn(`${label}失败: ${res.message ?? '未知错误'}`); this.mainView.setOpsStatus(`${label}失败`); }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          this.logger.error(`${label}异常: ${msg}`); this.mainView.setOpsStatus(`${label}异常`);
        } finally {
          btn.disabled = false;
          setTimeout(() => { this.mainView.setOpsStatus(''); }, 3000);
        }
      });
    };
    wrap('btn-ops-expedition', '收取远征', () => this.api.expeditionCheck());
    wrap('btn-ops-reward', '收取奖励', () => this.api.rewardCollect());
    wrap('btn-ops-build-collect', '收取建造', () => this.api.buildCollect());
    wrap('btn-ops-cook', '食堂烹饪', () => this.api.cook());
    wrap('btn-ops-repair', '浴室修理', () => this.api.repairBath());
  }

  updateOpsAvailability(connected: boolean): void {
    this.mainView.setOpsAvailability(connected);
  }
}
