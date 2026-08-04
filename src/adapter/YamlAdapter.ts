/** 统一 YAML 编解码及作战方案元数据读取。 */
import * as yaml from 'js-yaml';

export interface YamlCodec {
  parse<T>(content: string): T;
  stringify(value: unknown, options?: yaml.DumpOptions): string;
}

export const yamlCodec: YamlCodec = {
  parse<T>(content: string): T {
    return yaml.load(content) as T;
  },

  stringify(value: unknown, options?: yaml.DumpOptions): string {
    return yaml.dump(value, options);
  },
};

export interface PlanMetadata {
  chapter: number | string;
  map: number | string;
  event?: string;
  mode?: string;
  times?: number;
  gap?: number;
  task_type?: string;
  campaign_name?: string;
}

export function readPlanMetadata(content: string): PlanMetadata {
  const raw = yamlCodec.parse<Record<string, unknown>>(content);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('无效的方案文件');
  }

  const chapterRaw = raw.chapter;
  const mapRaw = raw.map;
  return {
    chapter: typeof chapterRaw === 'string' ? chapterRaw : Number(chapterRaw) || 0,
    map: typeof mapRaw === 'string' ? mapRaw : Number(mapRaw) || 0,
    event: typeof raw.event === 'string' ? raw.event : undefined,
    mode: typeof raw.mode === 'string' ? raw.mode : undefined,
    times: raw.times == null ? undefined : Number(raw.times),
    gap: raw.gap == null ? undefined : Number(raw.gap),
    task_type: typeof raw.task_type === 'string' ? raw.task_type : undefined,
    campaign_name: typeof raw.campaign_name === 'string' ? raw.campaign_name : undefined,
  };
}
