/**
 * 编队预设编辑弹窗。
 * 从 PlanPreviewView.showFleetEditDialog 提取。
 */
import type { FleetPresetVO } from '../../types/view';
import type { ShipSlot, ShipFilter } from '../../types/model';
import { ALL_NATIONS, ALL_SHIPS, TYPE_LABELS, toBackendName } from '../../data/shipData';
import { ShipAutocomplete } from '../shared/ShipAutocomplete';
import {
  showAlert,
  showSaveSuccess,
} from '../../controller/shared/DialogHelper';

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function matchShipTypeFilter(filterType: string, shipType: string): boolean {
  if (!filterType) return true;
  if (filterType === 'ss_or_ssg') return shipType === 'ss' || shipType === 'ssg';
  return shipType === filterType;
}

function buildPrioritySuggestions(nation: string, shipType: string, limit = 8): string[] {
  const seen = new Set<string>();
  const matched = ALL_SHIPS
    .filter((ship) => ship.nation === nation && matchShipTypeFilter(shipType, ship.ship_type))
    .slice()
    .sort((a, b) => Number(b.name.endsWith('·改')) - Number(a.name.endsWith('·改')));

  const names: string[] = [];
  for (const ship of matched) {
    const key = toBackendName(ship.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(ship.name);
    if (names.length >= limit) break;
  }
  return names;
}

function isAdvancedFilterSlot(slot: ShipSlot | undefined): boolean {
  if (!slot || typeof slot === 'string') return false;
  const nation = typeof slot.nation === 'string' ? slot.nation.trim() : '';
  const shipType = Array.isArray(slot.ship_type) ? slot.ship_type.join(',') : '';
  const hasCandidates = Array.isArray(slot.candidates)
    && slot.candidates.some(candidate => Boolean(candidate.name.trim()));
  return Boolean(nation || shipType || hasCandidates);
}

/**
 * 显示编队预设编辑弹窗。
 * @param index 编辑的预设索引（<0 表示新增）
 * @param preset 现有预设数据（新增时为 undefined）
 * @param onSave 保存回调
 */
export function showFleetEditDialog(
  index: number,
  preset: FleetPresetVO | undefined,
  onSave: (action: 'add' | 'edit', index: number, preset: FleetPresetVO) => void,
): void {
  const isNew = index < 0;
  const name = preset?.name ?? '';
  const ships = preset?.ships ?? [];

  const typeEntries = Object.entries(TYPE_LABELS);

  const overlay = document.createElement('div');
  overlay.className = 'fleet-edit-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'fleet-edit-dialog';

  // 构建每个槽位的 HTML
  const slotsHtml = [0, 1, 2, 3, 4, 5].map(i => {
    const slot = ships[i];
    const isObjectSlot = slot != null && typeof slot === 'object';
    const isFilter = isAdvancedFilterSlot(slot);
    const slotName = isObjectSlot ? ((slot as any).name ?? '') : '';
    const shipName = typeof slot === 'string' ? slot : (isFilter ? '' : slotName);
    const fixedName = isFilter ? slotName : '';
    const nation = isFilter ? ((slot as any).nation ?? '') : '';
    const shipType = isFilter && Array.isArray((slot as any).ship_type)
      ? ((slot as any).ship_type[0] ?? '')
      : '';
    const candidates = isFilter && Array.isArray((slot as any).candidates)
      ? (slot as any).candidates.map(
          (candidate: { name?: string }) => candidate.name ?? '',
        ).filter(Boolean).join(', ')
      : '';
    const minLevel = isObjectSlot && Number.isFinite((slot as any).min_level)
      ? String((slot as any).min_level)
      : '';
    const maxLevel = isObjectSlot && Number.isFinite((slot as any).max_level)
      ? String((slot as any).max_level)
      : '';

    const nationOpts = `<option value="">不限</option>` + ALL_NATIONS.map(
      (n: string) => `<option value="${escapeHtml(n)}"${n === nation ? ' selected' : ''}>${escapeHtml(n)}</option>`
    ).join('');
    const typeOpts = `<option value="">不限</option>` + typeEntries.map(
      ([code, label]) => `<option value="${escapeHtml(code)}"${code === shipType ? ' selected' : ''}>${escapeHtml(label as string)}</option>`
    ).join('');

    return `
      <div class="ship-slot-wrapper" data-slot="${i}">
        <div class="ship-slot-header">
          <span class="ship-slot-label">${i + 1}号位</span>
          <button type="button" class="ship-slot-toggle btn-xs${isFilter ? ' active' : ''}" title="切换模糊匹配">🔍</button>
        </div>
        <div class="ship-name-mode"${isFilter ? ' style="display:none"' : ''}>
          <input type="text" class="input fleet-edit-ship" placeholder="舰船名称" value="${escapeHtml(shipName)}" autocomplete="off" />
          <div class="fleet-edit-fixed-level-range">
            <input type="number" class="input fleet-edit-fixed-min-level" min="1" max="200" placeholder="最低等级（可选）" value="${escapeHtml(minLevel)}" />
            <input type="number" class="input fleet-edit-fixed-max-level" min="1" max="200" placeholder="最高等级（可选）" value="${escapeHtml(maxLevel)}" />
          </div>
        </div>
        <div class="ship-filter-mode"${isFilter ? '' : ' style="display:none"'}>
          <input type="text" class="input fleet-edit-filter-name" placeholder="固定舰名（可选）" value="${escapeHtml(fixedName)}" />
          <select class="input fleet-edit-nation">${nationOpts}</select>
          <select class="input fleet-edit-type">${typeOpts}</select>
          <input type="text" class="input fleet-edit-priority" placeholder="候选舰船（按填写顺序尝试）" value="${escapeHtml(candidates)}" />
          <div class="fleet-edit-priority-guide plan-task-hint" style="display:none">
            <span class="fleet-edit-priority-guide-text"></span>
            <button type="button" class="fleet-edit-priority-fill">填入建议</button>
          </div>
          <div class="fleet-edit-level-range">
            <input type="number" class="input fleet-edit-min-level" min="1" max="200" placeholder="最低等级" value="${escapeHtml(minLevel)}" />
            <input type="number" class="input fleet-edit-max-level" min="1" max="200" placeholder="最高等级" value="${escapeHtml(maxLevel)}" />
          </div>
        </div>
      </div>`;
  }).join('');

  dialog.innerHTML = `
    <h3>${isNew ? '新增编队' : '编辑编队'}</h3>
    <div class="form-group">
      <label>编队名称</label>
      <input type="text" id="fleet-edit-name" class="input" value="${escapeHtml(name)}" placeholder="例如：传统AIII双装母" />
    </div>
    <div class="form-group">
      <label>舰船（1~6号位，留空表示该位置无舰船）</label>
      <div class="fleet-edit-ships-grid">${slotsHtml}</div>
    </div>
    <div class="fleet-edit-actions">
      <button class="btn btn-outline" id="fleet-edit-cancel">取消</button>
      <button class="btn btn-primary" id="fleet-edit-save">保存</button>
    </div>
  `;

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const refreshPriorityGuide = (wrapper: Element): void => {
    const guide = wrapper.querySelector('.fleet-edit-priority-guide') as HTMLElement | null;
    const guideText = wrapper.querySelector('.fleet-edit-priority-guide-text') as HTMLElement | null;
    const fillBtn = wrapper.querySelector('.fleet-edit-priority-fill') as HTMLButtonElement | null;
    if (!guide || !guideText || !fillBtn) return;

    const filterMode = wrapper.querySelector('.ship-filter-mode') as HTMLElement | null;
    if (!filterMode || filterMode.style.display === 'none') {
      guide.style.display = 'none';
      return;
    }

    const nation = (wrapper.querySelector('.fleet-edit-nation') as HTMLSelectElement | null)?.value ?? '';
    const shipType = (wrapper.querySelector('.fleet-edit-type') as HTMLSelectElement | null)?.value ?? '';
    const candidatesInput = wrapper.querySelector('.fleet-edit-priority') as HTMLInputElement | null;
    const candidatesRaw = candidatesInput?.value.trim() ?? '';

    if (!nation || !shipType) {
      guide.style.display = 'none';
      return;
    }

    const suggestions = buildPrioritySuggestions(nation, shipType);

    if (candidatesRaw) {
      guideText.textContent = '已设置有限候选列表，可按逗号继续追加。';
      fillBtn.style.display = 'none';
      guide.style.display = '';
      return;
    }

    if (suggestions.length === 0) {
      guideText.textContent = '建议填写候选舰船（逗号分隔）以提高选船稳定性。';
      fillBtn.style.display = 'none';
      guide.style.display = '';
      return;
    }

    const preview = suggestions.slice(0, 4).join(' > ');
    guideText.textContent = `建议候选顺序：${preview}`;
    fillBtn.style.display = '';
    guide.style.display = '';
  };

  // 模式切换：指定 ↔ 模糊
  dialog.querySelectorAll('.ship-slot-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const wrapper = btn.closest('.ship-slot-wrapper')!;
      const nameMode = wrapper.querySelector('.ship-name-mode') as HTMLElement;
      const filterMode = wrapper.querySelector('.ship-filter-mode') as HTMLElement;
      const isActive = btn.classList.toggle('active');
      nameMode.style.display = isActive ? 'none' : '';
      filterMode.style.display = isActive ? '' : 'none';
      refreshPriorityGuide(wrapper);
    });
  });

  // 为每个舰船输入框绑定自动补全（使用共享组件，委托到 dialog）
  const shipAC = new ShipAutocomplete(dialog, '.fleet-edit-ship', { maxResults: 12 });

  dialog.querySelectorAll('.ship-slot-wrapper').forEach((wrapper) => {
    const nationSel = wrapper.querySelector('.fleet-edit-nation') as HTMLSelectElement | null;
    const typeSel = wrapper.querySelector('.fleet-edit-type') as HTMLSelectElement | null;
    const priorityInput = wrapper.querySelector('.fleet-edit-priority') as HTMLInputElement | null;
    const fillBtn = wrapper.querySelector('.fleet-edit-priority-fill') as HTMLButtonElement | null;

    nationSel?.addEventListener('change', () => refreshPriorityGuide(wrapper));
    typeSel?.addEventListener('change', () => refreshPriorityGuide(wrapper));
    priorityInput?.addEventListener('input', () => refreshPriorityGuide(wrapper));

    fillBtn?.addEventListener('click', () => {
      if (!priorityInput || !nationSel || !typeSel) return;
      const suggestions = buildPrioritySuggestions(nationSel.value, typeSel.value);
      if (suggestions.length === 0) return;
      priorityInput.value = suggestions.join(', ');
      refreshPriorityGuide(wrapper);
    });

    refreshPriorityGuide(wrapper);
  });

  const nameInput = dialog.querySelector('#fleet-edit-name') as HTMLInputElement;
  nameInput.focus();

  const close = () => { shipAC.destroy(); overlay.remove(); };

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  dialog.querySelector('#fleet-edit-cancel')!.addEventListener('click', close);

  dialog.querySelector('#fleet-edit-save')!.addEventListener('click', () => {
    const newName = nameInput.value.trim();
    if (!newName) {
      nameInput.focus();
      return;
    }
    const newShips: ShipSlot[] = [];
    dialog.querySelectorAll('.ship-slot-wrapper').forEach(wrapper => {
      const toggle = wrapper.querySelector('.ship-slot-toggle')!;
      const isFilterMode = toggle.classList.contains('active');
      if (isFilterMode) {
        const fixedName = (wrapper.querySelector('.fleet-edit-filter-name') as HTMLInputElement).value.trim();
        const nation = (wrapper.querySelector('.fleet-edit-nation') as HTMLSelectElement).value;
        const shipType = (wrapper.querySelector('.fleet-edit-type') as HTMLSelectElement).value;
        const candidatesRaw = (wrapper.querySelector('.fleet-edit-priority') as HTMLInputElement).value.trim();
        const minLevelRaw = (wrapper.querySelector('.fleet-edit-min-level') as HTMLInputElement).value.trim();
        const maxLevelRaw = (wrapper.querySelector('.fleet-edit-max-level') as HTMLInputElement).value.trim();
        const hasFilter = fixedName || nation || shipType || candidatesRaw || minLevelRaw || maxLevelRaw;
        if (hasFilter) {
          const filter: ShipFilter = {};
          if (fixedName) filter.name = fixedName;
          if (nation) filter.nation = nation;
          if (shipType) filter.ship_type = [shipType];
          if (candidatesRaw) {
            const names = candidatesRaw
              .split(/[，,]/)
              .map(s => s.trim())
              .filter(Boolean);
            if (names.length > 0) {
              filter.candidates = names.map(candidateName => ({
                name: candidateName,
              }));
            }
          }
          if (minLevelRaw) {
            const minLevel = parseInt(minLevelRaw, 10);
            if (!isNaN(minLevel) && minLevel > 0) filter.min_level = minLevel;
          }
          if (maxLevelRaw) {
            const maxLevel = parseInt(maxLevelRaw, 10);
            if (!isNaN(maxLevel) && maxLevel > 0) filter.max_level = maxLevel;
          }
          newShips.push(filter);
        }
      } else {
        const v = (wrapper.querySelector('.fleet-edit-ship') as HTMLInputElement).value.trim();
        const minLevelRaw = (wrapper.querySelector('.fleet-edit-fixed-min-level') as HTMLInputElement).value.trim();
        const maxLevelRaw = (wrapper.querySelector('.fleet-edit-fixed-max-level') as HTMLInputElement).value.trim();

        let minLevel: number | undefined;
        if (minLevelRaw) {
          const parsed = parseInt(minLevelRaw, 10);
          if (!isNaN(parsed) && parsed > 0) minLevel = parsed;
        }

        let maxLevel: number | undefined;
        if (maxLevelRaw) {
          const parsed = parseInt(maxLevelRaw, 10);
          if (!isNaN(parsed) && parsed > 0) maxLevel = parsed;
        }

        if (!v) return;

        if (minLevel != null || maxLevel != null) {
          const filter: ShipFilter = { name: v };
          if (minLevel != null) filter.min_level = minLevel;
          if (maxLevel != null) filter.max_level = maxLevel;
          newShips.push(filter);
        } else {
          newShips.push(v);
        }
      }
    });

    const newPreset: FleetPresetVO = { name: newName, ships: newShips };
    try {
      if (isNew) {
        onSave('add', -1, newPreset);
      } else {
        onSave('edit', index, newPreset);
      }
      close();
      showSaveSuccess(`编队设置「${newName}」保存成功`);
    } catch (error) {
      void showAlert(
        '保存失败',
        error instanceof Error ? error.message : String(error),
      );
    }
  });
}
