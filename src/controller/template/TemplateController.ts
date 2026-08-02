/**
 * TemplateController —— 模板系统控制器（精简版）。
 * 向导逻辑 → wizard.ts，使用模板 → useTemplate.ts，
 * 选择弹窗 → selectors.ts，CRUD → crud.ts。
 */
import { TemplateModel } from '../../model/TemplateModel';
import { TaskGroupModel } from '../../model/TaskGroupModel';
import type { TemplateLibraryItemVO } from '../../types/view';
import { TemplateLibraryView } from '../../view/template/TemplateLibraryView';
import { TemplateWizardView } from '../../view/template/TemplateWizardView';
import { Logger } from '../../utils/Logger';
import { showWizard, wizardNav, finishWizard } from './wizard';
import { useTemplateFlow, type UseTemplateCallbacks } from './useTemplate';
import { showPlanSelector, showCampaignSelector, showExerciseFleetSelector, showDecisiveChapterSelector } from './selectors';
import { editTemplate, deleteTemplate, renameTemplate, importTemplatesFlow } from './crud';

export class TemplateController {
  static readonly TEMPLATE_TYPE_LABELS: Record<string, string> = {
    normal_fight: '普通出击',
    event_fight: '活动出击',
    exercise: '演习',
    campaign: '战役',
    decisive: '决战',
  };

  private _wizardPlanPaths: string[] = [];
  private _editingTemplateId: string | null = null;
  private libraryView: TemplateLibraryView;
  private wizardView: TemplateWizardView;

  /** Ref-wrapper for extracted modules to mutate state */
  private get wizardPlanPathsRef() { return { value: this._wizardPlanPaths, set: (v: string[]) => { this._wizardPlanPaths = v; } }; }
  private get editingIdRef() { return { value: this._editingTemplateId, set: (v: string | null) => { this._editingTemplateId = v; } }; }

  constructor(
    private readonly templateModel: TemplateModel,
    private readonly taskGroupModel: TaskGroupModel,
    private readonly renderTaskGroup: () => void,
    public plansDir: string,
    public appRoot: string,
  ) {
    this.libraryView = new TemplateLibraryView();
    this.wizardView = new TemplateWizardView();
  }

  // ════════════════════════════════════════
  // 公共接口
  // ════════════════════════════════════════

  bindActions(): void {
    // 创建模板按钮
    document.getElementById('btn-create-template')?.addEventListener('click', () => {
      showWizard(this.wizardView, this.wizardPlanPathsRef as any, this.editingIdRef as any);
    });

    // 导入模板按钮
    document.getElementById('btn-import-template')?.addEventListener('click', () => {
      importTemplatesFlow(this.templateModel, this.wizardView, this.wizardPlanPathsRef as any, this.appRoot, () => this.renderLibrary());
    });

    // 向导：上一步 / 下一步 / 取消
    document.getElementById('btn-wizard-prev')?.addEventListener('click', () => {
      wizardNav(-1, this.wizardView, () => this.doFinishWizard());
    });
    document.getElementById('btn-wizard-next')?.addEventListener('click', () => {
      wizardNav(1, this.wizardView, () => this.doFinishWizard());
    });
    document.getElementById('btn-wizard-cancel')?.addEventListener('click', () => this.wizardView.hide());

    // 步骤1：切换类型 → 切换步骤2配置面板
    document.querySelectorAll<HTMLInputElement>('input[name="tpl-type"]').forEach(radio => {
      radio.addEventListener('change', () => this.wizardView.setConfigPanel(this.wizardView.getSelectedType()));
    });

    // 步骤2：浏览添加方案文件
    document.getElementById('btn-tpl-browse-plan')?.addEventListener('click', async () => {
      const bridge = window.electronBridge;
      if (!bridge) return;
      const result = await bridge.openFileDialog(
        [{ name: 'YAML 方案', extensions: ['yaml', 'yml'] }],
        this.plansDir || undefined,
      );
      if (!result) return;
      const filePath = result.path;
      if (!this._wizardPlanPaths.includes(filePath)) {
        this._wizardPlanPaths.push(filePath);
        this.wizardView.renderPlanList(this._wizardPlanPaths);
      }
      this.wizardView.setPlanPathInput(filePath);
      if (this._wizardPlanPaths.length === 1) {
        try {
          const parsed = (await import('js-yaml')).load(result.content) as Record<string, any>;
          if (!parsed || typeof parsed !== 'object') return;
          if (parsed.fleet_id) {
            this.wizardView.setFleetId(parsed.fleet_id);
          }
          const presets = parsed.fleet_presets as any[] | undefined;
          if (presets?.length && presets[0].ships?.length) {
            this.wizardView.fillFleetGrid('nf', presets[0].ships);
          }
          const sc = parsed.stop_condition as any;
          if (sc) {
            if (sc.loot_count_ge != null && sc.loot_count_ge >= 0) {
              this.wizardView.setStopConditions(sc.loot_count_ge, undefined);
            }
            if (sc.ship_count_ge != null && sc.ship_count_ge >= 0) {
              this.wizardView.setStopConditions(undefined, sc.ship_count_ge);
            }
          }
          const fileName = filePath.split(/[\\/]/).pop()?.replace(/\.ya?ml$/i, '') ?? '';
          if (fileName) {
            this.wizardView.setName(fileName);
          }
          if (parsed.times) {
            this.wizardView.setDefaultTimes(parsed.times);
          }
        } catch { /* YAML 解析失败不影响流程 */ }
      }
    });

    // 步骤2：从方案目录扫描添加
    document.getElementById('btn-tpl-scan-plans')?.addEventListener('click', async () => {
      const bridge = window.electronBridge;
      if (!bridge?.listPlanFiles) return;
      const files = await bridge.listPlanFiles();
      let added = 0;
      for (const f of files) {
        const fullPath = `${this.plansDir}\\${f.file}`;
        if (!this._wizardPlanPaths.includes(fullPath)) {
          this._wizardPlanPaths.push(fullPath);
          added++;
        }
      }
      if (added > 0) this.wizardView.renderPlanList(this._wizardPlanPaths);
      Logger.info(`扫描到 ${files.length} 个方案文件，新增 ${added} 个`);
    });

    // 步骤2：方案列表删除按钮
    document.getElementById('tpl-plan-list')?.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.btn-remove-plan') as HTMLElement | null;
      if (!btn) return;
      const idx = parseInt(btn.dataset.idx ?? '-1');
      if (idx >= 0 && idx < this._wizardPlanPaths.length) {
        this._wizardPlanPaths.splice(idx, 1);
        this.wizardView.renderPlanList(this._wizardPlanPaths);
      }
    });

    // 步骤2：编队设置开关
    for (const suffix of ['nf', 'ex', 'cp']) {
      const cb = document.getElementById(`tpl-fleet-enable-${suffix}`) as HTMLInputElement | null;
      const grid = document.getElementById(`tpl-fleet-grid-${suffix}`);
      cb?.addEventListener('change', () => {
        if (grid) grid.style.display = cb.checked ? '' : 'none';
      });
    }

    // Library view 回调
    this.libraryView.onUse = (id) => this.doUseTemplate(id);
    this.libraryView.onEdit = (id) => editTemplate(id, this.templateModel, this.wizardView, this.wizardPlanPathsRef as any, this.editingIdRef as any);
    this.libraryView.onDelete = (id) => deleteTemplate(id, this.templateModel, () => this.renderLibrary());
    this.libraryView.onRename = (id) => renameTemplate(id, this.templateModel, () => this.renderLibrary());

    // 初始渲染模板库
    this.renderLibrary();
  }

  renderLibrary(): void {
    const templates = this.templateModel.getAll()
      .filter(tpl => tpl.type !== 'decisive');
    const items: TemplateLibraryItemVO[] = templates.map(tpl => ({
      id: tpl.id,
      name: tpl.name,
      type: tpl.type,
      typeLabel: TemplateController.TEMPLATE_TYPE_LABELS[tpl.type] ?? tpl.type,
      planCount: tpl.planPaths?.length ?? (tpl.planPath ? 1 : 0),
      defaultTimes: tpl.defaultTimes ?? 0,
      description: tpl.description,
      isBuiltin: !!tpl.builtin,
    }));
    this.libraryView.render(items);
    this.populateDecisiveSelect();
  }

  populateDecisiveSelect(selectedId?: string): void {
    const decisiveTemplates = this.templateModel.getAll()
      .filter(t => t.type === 'decisive')
      .map(t => ({ id: t.id, name: t.name }));
    this.libraryView.populateDecisiveSelect(decisiveTemplates, selectedId);
  }

  // ════════════════════════════════════════
  // 内部代理
  // ════════════════════════════════════════

  private async doFinishWizard(): Promise<void> {
    await finishWizard(
      this.wizardView, this.templateModel,
      this._wizardPlanPaths, this.editingIdRef as any,
      () => this.renderLibrary(),
    );
  }

  private async doUseTemplate(id: string): Promise<void> {
    const callbacks: UseTemplateCallbacks = {
      showPlanSelector: (tpl, paths, gn) => showPlanSelector(tpl, paths, gn, this.wizardView, this.taskGroupModel, this.renderTaskGroup),
      showCampaignSelector: (tpl, gn) => showCampaignSelector(tpl, gn, this.wizardView, this.taskGroupModel, this.renderTaskGroup),
      showExerciseFleetSelector: (tpl, gn) => showExerciseFleetSelector(tpl, gn, this.wizardView, this.taskGroupModel, this.renderTaskGroup),
      showDecisiveChapterSelector: (tpl, gn) => showDecisiveChapterSelector(tpl, gn, this.wizardView, this.taskGroupModel, this.renderTaskGroup),
    };
    await useTemplateFlow(id, this.templateModel, this.taskGroupModel, this.renderTaskGroup, callbacks);
  }
}
