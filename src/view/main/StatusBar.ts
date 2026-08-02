import type { MainViewObject } from '../../types/view';
import { resolveTaskProgressPercent } from './TaskQueueView';

export class StatusBar {
  private statusDot: HTMLElement;
  private statusText: HTMLElement;
  private expeditionTimer: HTMLElement;
  private taskState: HTMLElement;
  private taskName: HTMLElement;
  private taskRemaining: HTMLElement;
  private taskProgress: HTMLElement;
  private taskProgressFill: HTMLElement;

  private static readonly OPS_BTN_IDS = [
    'btn-ops-expedition', 'btn-ops-reward', 'btn-ops-build-collect', 'btn-ops-cook', 'btn-ops-repair',
  ];

  constructor() {
    this.statusDot = document.getElementById('status-dot')!;
    this.statusText = document.getElementById('status-text')!;
    this.expeditionTimer = document.getElementById('expedition-timer')!;
    this.taskState = document.getElementById('nav-task-state')!;
    this.taskName = document.getElementById('nav-task-name')!;
    this.taskRemaining = document.getElementById('nav-task-remaining')!;
    this.taskProgress = document.getElementById('nav-task-progress')!;
    this.taskProgressFill = document.getElementById('nav-task-progress-fill')!;
  }

  render(vo: MainViewObject): void {
    this.statusDot.className = `status-indicator ${vo.status}`;
    this.statusText.textContent = vo.statusText;
    this.expeditionTimer.textContent = vo.expeditionTimer;

    const running = vo.taskQueue.find(item => item.id === vo.runningTaskId);
    if (!running) {
      this.taskState.classList.remove('active');
      this.taskState.title = '当前无运行任务';
      this.taskName.textContent = '当前无任务';
      this.taskRemaining.textContent = '剩余 0/0';
      this.taskProgressFill.style.width = '0%';
      this.taskProgress.setAttribute('aria-valuenow', '0');
      return;
    }

    const progressPercent = resolveTaskProgressPercent(running, true);
    const progressValue = Math.round(progressPercent * 100);
    const remainingText = running.unlimited
      ? '无限'
      : `${running.remaining}/${running.totalTimes}`;
    this.taskState.classList.add('active');
    this.taskState.title = `${running.name}，剩余 ${remainingText}`;
    this.taskName.textContent = running.name;
    this.taskRemaining.textContent = `剩余 ${remainingText}`;
    this.taskProgressFill.style.width = `${(progressPercent * 100).toFixed(1)}%`;
    this.taskProgress.setAttribute('aria-valuenow', String(progressValue));
  }

  setOpsAvailability(connected: boolean): void {
    for (const id of StatusBar.OPS_BTN_IDS) {
      const btn = document.getElementById(id) as HTMLButtonElement | null;
      if (btn) btn.disabled = !connected;
    }
    this.setOpsStatus(connected ? '' : '未连接');
  }

  setOpsStatus(text: string): void {
    const el = document.getElementById('ops-status');
    if (el) el.textContent = text;
  }

  setVersion(v: string): void {
    const el = document.getElementById('app-version');
    if (el) el.textContent = v;
  }
}
