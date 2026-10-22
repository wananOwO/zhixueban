export type AppErrorCode =
  | 'DISABLED' | 'NOT_INITIALIZED' | 'UNAUTHENTICATED' | 'FORBIDDEN'
  | 'PAYLOAD_TOO_LARGE' | 'LIMIT_EXCEEDED' | 'IN_PROGRESS'
  | 'PROVIDER_ERROR' | 'JUDGE_UNAVAILABLE' | 'INTERNAL_ERROR';

export class AppError extends Error {
  constructor(readonly code: AppErrorCode, message: string) {
    super(message);
    this.name = 'AppError';
  }
}
