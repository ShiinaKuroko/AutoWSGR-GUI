/**
 * GUI 版本和更新频道规则。
 *
 * 稳定版使用 X.Y.Z 和 latest 频道。
 * 预发布版使用 X.Y.Z-beta.N 和 beta 频道。
 * 开发版使用 X.Y.Z-dev.N 和 dev 频道。
 *
 * 发布端和客户端必须使用同一规则。客户端还会验证服务端返回的候选
 * 版本，防止 electron-updater 在频道清单缺失时回退到其他频道。
 */

export type GuiReleaseChannel = 'latest' | 'beta' | 'dev';
export type GuiReleaseStage = 'stable' | 'prerelease' | 'development';

export interface GuiReleasePolicy {
  channel: GuiReleaseChannel;
  stage: GuiReleaseStage;
  allowPrerelease: boolean;
}

export type GuiUpdateCheckResult =
  | { status: 'available'; version: string }
  | { status: 'up-to-date' }
  | { status: 'error'; message: string };

export interface UpdaterCheckResultLike {
  isUpdateAvailable: boolean;
  updateInfo?: {
    version?: string;
  };
}

const STABLE_VERSION = /^\d+\.\d+\.\d+$/;
const BETA_VERSION = /^\d+\.\d+\.\d+-beta\.\d+$/;
const DEVELOPMENT_VERSION = /^\d+\.\d+\.\d+-dev\.\d+$/;

/** 严格解析 GUI 版本，拒绝没有明确频道的版本后缀。 */
export function resolveGuiReleasePolicy(version: string): GuiReleasePolicy {
  const normalized = version.trim();
  if (STABLE_VERSION.test(normalized)) {
    return {
      channel: 'latest',
      stage: 'stable',
      allowPrerelease: false,
    };
  }
  if (BETA_VERSION.test(normalized)) {
    return {
      channel: 'beta',
      stage: 'prerelease',
      allowPrerelease: true,
    };
  }
  if (DEVELOPMENT_VERSION.test(normalized)) {
    return {
      channel: 'dev',
      stage: 'development',
      allowPrerelease: true,
    };
  }
  throw new Error(
    `GUI 版本 ${version} 不符合规范；只允许 X.Y.Z、`
    + 'X.Y.Z-beta.N 或 X.Y.Z-dev.N',
  );
}

/** 返回候选版本不属于当前频道时的明确错误。 */
export function validateGuiUpdateCandidate(
  currentPolicy: GuiReleasePolicy,
  candidateVersion: string,
): string | null {
  let candidatePolicy: GuiReleasePolicy;
  try {
    candidatePolicy = resolveGuiReleasePolicy(candidateVersion);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  if (candidatePolicy.channel === currentPolicy.channel) return null;
  return `更新版本 ${candidateVersion} 属于 ${candidatePolicy.channel} 频道，`
    + `当前客户端只允许 ${currentPolicy.channel} 频道`;
}

/** 将 electron-updater 的结果转换为可靠的三态结果。 */
export function classifyGuiUpdateCheck(
  currentPolicy: GuiReleasePolicy,
  result: UpdaterCheckResultLike | null,
): GuiUpdateCheckResult {
  if (result === null) {
    return {
      status: 'error',
      message: '当前运行环境未启用 GUI 自动更新',
    };
  }
  if (!result.isUpdateAvailable) {
    return { status: 'up-to-date' };
  }

  const version = result.updateInfo?.version?.trim();
  if (!version) {
    return {
      status: 'error',
      message: '更新服务返回了无效的版本信息',
    };
  }
  const mismatch = validateGuiUpdateCandidate(currentPolicy, version);
  if (mismatch) return { status: 'error', message: mismatch };
  return { status: 'available', version };
}
