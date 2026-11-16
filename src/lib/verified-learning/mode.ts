import { AppError } from './errors';
import { readLocalConfig } from './local-access';

/**
 * 运行模式：同一份代码，环境变量切换（规格 8.4）。
 * - local（默认）：仅 127.0.0.1:3101，默认免登录，可配置固定密码，固定 local-owner 空间。
 * - online：公网域名 + 访问码，每个浏览器一个独立空间，模型 Key 只在浏览器与服务器内存。
 */
export type VlMode = 'local' | 'online';
export interface ModeConfig { mode: VlMode; publicOrigin: string | null; accessCode: string | null }

export const LOCAL_UPLOAD_BYTES = 50 * 1024 * 1024;
export const ONLINE_LIMITS = {
  uploadBytes: 20 * 1024 * 1024,
  booksPerSpace: 10,
  concurrentPerSpace: 1,
  dailyPerSpace: 20,
  concurrentGlobal: 6,
  sessionDays: 30,
  spaceDays: 90,
  idleDeleteDays: 30,
  loginPerMinutePerIp: 5,
} as const;

function disabled(message: string): never {
  throw new AppError('DISABLED', message);
}

export function readMode(env: Record<string, string | undefined> = process.env): ModeConfig {
  if (env.VL_MODE !== 'online') return { mode: 'local', publicOrigin: null, accessCode: null };
  const origin = env.VL_PUBLIC_ORIGIN ?? '';
  let url: URL;
  try { url = new URL(origin); } catch { disabled('线上模式需要配置 VL_PUBLIC_ORIGIN'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || origin.replace(/\/$/, '') !== url.origin) {
    disabled('VL_PUBLIC_ORIGIN 必须是不带路径的 https:// 地址');
  }
  const code = env.VL_ACCESS_CODE ?? '';
  if (code.length < 8 || code.length > 128) disabled('线上模式需要配置至少 8 位的 VL_ACCESS_CODE');
  return { mode: 'online', publicOrigin: url.origin, accessCode: code };
}

export function isOnline(env: Record<string, string | undefined> = process.env): boolean {
  return env.VL_MODE === 'online';
}

/** 前端用于展示上传上限与模式文案；不含任何秘密 */
export function modeView(env: Record<string, string | undefined> = process.env) {
  const { mode } = readMode(env);
  return mode === 'online'
    ? { mode, authRequired: true, uploadLimitBytes: ONLINE_LIMITS.uploadBytes, booksPerSpace: ONLINE_LIMITS.booksPerSpace }
    : { mode, authRequired: readLocalConfig(env).authRequired, uploadLimitBytes: LOCAL_UPLOAD_BYTES, booksPerSpace: null };
}
