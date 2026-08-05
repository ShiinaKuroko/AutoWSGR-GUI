/** 封装 Renderer 通用确认、提示和输入对话框。 */
/**
 * DialogHelper —— 通用对话框工具类。
 * 封装通用对话框和页面顶部的保存成功提示。
 */

let saveSuccessTimer: number | null = null;

/** 仅在数据确认写入成功后调用。 */
export function showSaveSuccess(message = '保存成功'): void {
  let notice = document.getElementById('save-success-notice');
  if (!notice) {
    notice = document.createElement('div');
    notice.id = 'save-success-notice';
    notice.className = 'save-success-notice';
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    notice.setAttribute('aria-hidden', 'true');

    const icon = document.createElement('span');
    icon.className = 'save-success-notice-icon';
    icon.textContent = '✓';
    icon.setAttribute('aria-hidden', 'true');

    const text = document.createElement('span');
    text.className = 'save-success-notice-text';
    notice.append(icon, text);
    document.body.append(notice);
  }

  const text = notice.querySelector<HTMLElement>('.save-success-notice-text');
  if (text) text.textContent = message;
  notice.classList.add('is-visible');
  notice.setAttribute('aria-hidden', 'false');

  if (saveSuccessTimer !== null) {
    window.clearTimeout(saveSuccessTimer);
  }
  saveSuccessTimer = window.setTimeout(() => {
    notice?.classList.remove('is-visible');
    notice?.setAttribute('aria-hidden', 'true');
    saveSuccessTimer = null;
  }, 2400);
}

/** 弹出输入框，返回用户输入的字符串，取消返回 null */
export function showPrompt(
  title: string,
  message = '',
  defaultValue = '',
): Promise<string | null> {
  const overlay = document.getElementById('generic-prompt')!;
  const titleEl = document.getElementById('generic-prompt-title')!;
  const msgEl = document.getElementById('generic-prompt-message')!;
  const inputEl = document.getElementById(
    'generic-prompt-input',
  ) as HTMLInputElement;
  const okBtn = document.getElementById('generic-prompt-ok')!;
  const cancelBtn = document.getElementById('generic-prompt-cancel')!;

  titleEl.textContent = title;
  msgEl.textContent = message;
  msgEl.style.display = message ? '' : 'none';
  inputEl.style.display = '';
  inputEl.value = defaultValue;
  cancelBtn.style.display = '';
  overlay.style.display = '';
  inputEl.focus();
  inputEl.select();

  return new Promise<string | null>((resolve) => {
    const cleanup = () => {
      overlay.style.display = 'none';
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      inputEl.removeEventListener('keydown', onKey);
    };
    const onOk = () => {
      cleanup();
      resolve(inputEl.value);
    };
    const onCancel = () => {
      cleanup();
      resolve(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Enter') onOk();
      if (event.key === 'Escape') onCancel();
    };
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    inputEl.addEventListener('keydown', onKey);
  });
}

/** 弹出确认框，返回 true/false */
export function showConfirm(title: string, message = ''): Promise<boolean> {
  const overlay = document.getElementById('generic-prompt')!;
  const titleEl = document.getElementById('generic-prompt-title')!;
  const msgEl = document.getElementById('generic-prompt-message')!;
  const inputEl = document.getElementById(
    'generic-prompt-input',
  ) as HTMLInputElement;
  const okBtn = document.getElementById('generic-prompt-ok')!;
  const cancelBtn = document.getElementById('generic-prompt-cancel')!;

  titleEl.textContent = title;
  msgEl.textContent = message;
  msgEl.style.display = message ? '' : 'none';
  inputEl.style.display = 'none';
  cancelBtn.style.display = '';
  overlay.style.display = '';
  okBtn.focus();

  return new Promise<boolean>((resolve) => {
    const cleanup = () => {
      overlay.style.display = 'none';
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
    };
    const onOk = () => {
      cleanup();
      resolve(true);
    };
    const onCancel = () => {
      cleanup();
      resolve(false);
    };
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  });
}

/** 弹出提示框（只有确定按钮） */
export function showAlert(title: string, message = ''): Promise<void> {
  const overlay = document.getElementById('generic-prompt')!;
  const titleEl = document.getElementById('generic-prompt-title')!;
  const msgEl = document.getElementById('generic-prompt-message')!;
  const inputEl = document.getElementById(
    'generic-prompt-input',
  ) as HTMLInputElement;
  const okBtn = document.getElementById('generic-prompt-ok')!;
  const cancelBtn = document.getElementById('generic-prompt-cancel')!;

  titleEl.textContent = title;
  msgEl.textContent = message;
  msgEl.style.display = message ? '' : 'none';
  inputEl.style.display = 'none';
  cancelBtn.style.display = 'none';
  overlay.style.display = '';
  okBtn.focus();

  return new Promise<void>((resolve) => {
    const cleanup = () => {
      overlay.style.display = 'none';
      okBtn.removeEventListener('click', onOk);
    };
    const onOk = () => {
      cleanup();
      resolve();
    };
    okBtn.addEventListener('click', onOk);
  });
}
