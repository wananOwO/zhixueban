'use client';

import { ApiError } from '@/lib/verified-learning/client';

/** 按错误码给出可操作的恢复提示 */
export function errorHint(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 401:
        return '登录已失效，请重新输入本机口令。';
      case 409:
        return '内容已被其他地方修改，请刷新后再试（你的输入已保留在本页）。';
      case 422:
        return '输入未通过校验，请按提示修改。';
      case 502:
      case 503:
        return '模型或判题服务未就绪，请检查本地环境变量配置后重试。';
      default:
        if (error.code === 'NETWORK') return '网络错误，请确认本地服务仍在运行。';
    }
  }
  return '';
}

export default function ErrorBox({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  const hint = errorHint(error);
  return (
    <div
      role="alert"
      className="rounded-md border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger"
    >
      <p>{message}</p>
      {hint && <p className="mt-1 text-danger/80">{hint}</p>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 rounded-md border border-danger/40 px-3 py-1 text-xs font-medium hover:bg-danger/10"
        >
          重试
        </button>
      )}
    </div>
  );
}
