// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RetrievalIndexPanel, type RetrievalIndexStatus } from '@/components/library/retrieval-index-panel';

afterEach(cleanup);

const base: RetrievalIndexStatus = { status: 'none', profileId: null, ready: 0, failed: 0, total: 0, jobId: null, usable: false, configured: false, model: null };

function setup(status: RetrievalIndexStatus, handlers: Partial<Record<'onStart' | 'onResume' | 'onCancel' | 'onRetry', () => void>> = {}) {
  const onStart = vi.fn(handlers.onStart);
  const onResume = vi.fn(handlers.onResume);
  const onCancel = vi.fn(handlers.onCancel);
  const onRetry = vi.fn(handlers.onRetry);
  render(<RetrievalIndexPanel status={status} onStart={onStart} onResume={onResume} onCancel={onCancel} onRetry={onRetry} pending={false} error={null} />);
  return { onStart, onResume, onCancel, onRetry };
}

describe('教材详情：语义索引面板', () => {
  it('未配置时只提示去设置，不显示建立按钮', () => {
    setup(base);
    expect(screen.getByText(/未配置 Embedding/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /建立语义索引/ })).toBeNull();
    expect(screen.getByRole('link', { name: '去设置' }).getAttribute('href')).toBe('/settings');
  });

  it('建立前必须确认，确认后才回调', () => {
    const { onStart } = setup({ ...base, configured: true, model: 'embed-mini' });
    fireEvent.click(screen.getByRole('button', { name: /建立语义索引/ }));
    expect(onStart).not.toHaveBeenCalled();
    expect(screen.getByText(/发送给所选 Embedding 服务/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '确认建立' }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('取消确认不发起任何请求', () => {
    const { onStart } = setup({ ...base, configured: true, model: 'embed-mini' });
    fireEvent.click(screen.getByRole('button', { name: /建立语义索引/ }));
    fireEvent.click(screen.getByRole('button', { name: '先不建立' }));
    expect(onStart).not.toHaveBeenCalled();
  });

  it('进行中显示进度并可停止', () => {
    const { onCancel } = setup({ ...base, configured: true, model: 'embed-mini', status: 'running', jobId: 'j1', ready: 12, total: 40 });
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('12');
    expect(screen.getByText(/12 \/ 40/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '停止索引' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('失败时说明已降级关键词检索并可重试', () => {
    const { onRetry } = setup({ ...base, configured: true, model: 'embed-mini', status: 'failed', jobId: 'j1', ready: 3, total: 40, failed: 2 });
    expect(screen.getByRole('alert').textContent).toContain('关键词检索');
    fireEvent.click(screen.getByRole('button', { name: /重试/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('可恢复任务显示继续', () => {
    const { onResume } = setup({ ...base, configured: true, model: 'embed-mini', status: 'waiting_user', jobId: 'j1', ready: 20, total: 40 });
    fireEvent.click(screen.getByRole('button', { name: /继续索引/ }));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('全部就绪后显示可用与模型名', () => {
    setup({ ...base, configured: true, model: 'embed-mini', status: 'succeeded', jobId: 'j1', ready: 40, total: 40, usable: true });
    expect(screen.getByText(/语义检索已可用/)).toBeTruthy();
    expect(screen.getByText(/embed-mini/)).toBeTruthy();
  });
});