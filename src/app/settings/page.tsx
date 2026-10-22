'use client';

import { useCallback, useEffect, useState } from 'react';
import ErrorBox from '@/components/verified-learning/error-box';
import { api } from '@/lib/verified-learning/client';

type Settings = Record<string, string | boolean>;
const fields = [
  ['llm_base_url', 'API 地址（Base URL）', 'https://api.deepseek.com/v1'],
  ['llm_api_key', 'API Key', '留空保持原密钥'],
  ['embedding_model', 'Embedding 模型', 'text-embedding-3-small'],
  ['embedding_base_url', 'Embedding API 地址', '留空使用环境变量或大模型地址'],
  ['embedding_api_key', 'Embedding API Key', '留空保持原值；未配置时使用大模型密钥'],
] as const;

function SettingsForm() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [modelError, setModelError] = useState<unknown>(null);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelMessage, setModelMessage] = useState('');

  async function fetchModels() {
    setFetchingModels(true); setModelError(null); setModelMessage(''); setModels([]);
    try {
      const result = await api<{ models: { id: string; name: string }[]; truncated: boolean }>('/settings/models', 'POST', {
        provider: form.llm_provider || 'openai-compatible', baseUrl: form.llm_base_url || '', apiKey: form.llm_api_key || '',
      });
      setModels(result.models);
      setModelMessage(result.models.length ? `已拉取 ${result.models.length} 个模型${result.truncated ? '（供应商仍有更多模型，可手动输入）' : ''}` : '供应商未返回可用模型，可手动填写。');
    } catch (e) { setModelError(e); }
    finally { setFetchingModels(false); }
  }
  function change(key: string, value: string) {
    setForm(prev => ({ ...prev, [key]: value })); setMessage('');
    if (['llm_provider', 'llm_base_url', 'llm_api_key'].includes(key)) { setModels([]); setModelError(null); setModelMessage(''); }
  }
  const load = useCallback(async () => {
    try {
      const data = await api<Settings>('/settings');
      setSettings(data);
      setForm(Object.fromEntries(Object.entries(data).filter((entry): entry is [string, string] => typeof entry[1] === 'string')));
      setError(null);
    } catch (e) { setError(e); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true); setError(null); setMessage('');
    try {
      const data = await api<Settings>('/settings', 'PATCH', form);
      setSettings(data);
      setForm(Object.fromEntries(Object.entries(data).filter((entry): entry is [string, string] => typeof entry[1] === 'string')));
      setMessage('已保存，后续模型请求立即使用新配置。');
    } catch (e) { setError(e); }
    finally { setSaving(false); }
  }

  return (
    <main aria-label="页面内容" className="mx-auto max-w-2xl">
      <h1 className="mb-2 text-2xl font-bold">设置 · API 供应商</h1>
      <p className="mb-6 text-sm text-muted-foreground">配置当前使用的供应商。网页设置优先于环境变量；密钥只保存在本机数据库，不回显。这里只保存配置，不会发起付费模型调用。</p>
      <ErrorBox error={error} onRetry={!settings ? load : undefined} />
      {!settings ? (!error && <p role="status">正在读取设置…</p>) : (
        <form onSubmit={save} className="space-y-5">
          <fieldset disabled={saving || fetchingModels} className="space-y-4 rounded-lg border border-border p-4">
            <legend className="px-1 font-semibold">供应商与模型</legend>
            <label className="block text-sm">供应商协议
              <select value={form.llm_provider ?? 'openai-compatible'} onChange={e => change('llm_provider', e.target.value)} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2">
                <option value="openai-compatible">OpenAI 兼容（OpenAI / DeepSeek / 智谱等）</option>
                <option value="anthropic">Anthropic Claude</option>
              </select>
            </label>
            <p className="text-xs text-muted-foreground">更换供应商时请同时核对模型、API 地址和密钥。地址留空使用环境变量或协议默认值。</p>
            {fields.map(([key, label, placeholder]) => (
              <label key={key} className="block text-sm">{label}
                <input type={key.endsWith('_api_key') ? 'password' : 'text'} value={form[key] ?? ''} autoComplete={key.endsWith('_api_key') ? 'new-password' : 'off'} placeholder={placeholder} maxLength={key.endsWith('_api_key') ? 4096 : key.endsWith('_url') ? 2000 : 300} onChange={e => change(key, e.target.value)} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2" />
                {key.endsWith('_api_key') && <span className="mt-1 block text-xs text-muted-foreground">{settings[`${key}_configured`] ? '已配置；输入新值可替换。' : '未单独配置。'}</span>}
              </label>
            ))}
            <section className="space-y-3 border-t border-border pt-4" aria-label="模型选择">
              <button type="button" onClick={() => void fetchModels()} className="rounded-md border border-border px-3 py-2 text-sm">{fetchingModels ? '正在拉取模型…' : '拉取模型列表'}</button>
              <p className="text-xs text-muted-foreground">使用当前填写的地址和密钥查询，无需先保存；仅请求模型列表，不发起生成。</p>
              <ErrorBox error={modelError} />
              <p role="status" className="text-sm text-muted-foreground">{modelMessage}</p>
              {models.length > 0 && <label htmlFor="available-model" className="block text-sm">选择模型
                <select id="available-model" aria-label="选择模型" value={models.some(m => m.id === form.llm_model) ? form.llm_model : ''} onChange={e => change('llm_model', e.target.value)} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2">
                  <option value="">请选择模型…</option>
                  {models.map(m => <option key={m.id} value={m.id}>{m.name === m.id ? m.id : `${m.name} · ${m.id}`}</option>)}
                </select>
              </label>}
              <label className="block text-sm">模型名称（可手动填写）<input value={form.llm_model ?? ''} onChange={e => change('llm_model', e.target.value)} maxLength={300} placeholder="例如：deepseek-chat" className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2" /></label>
            </section>
          </fieldset>
          <p role="status" className="text-sm text-success">{message}</p>
          <button type="submit" disabled={saving || fetchingModels} className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50">{saving ? '保存中…' : '保存供应商配置'}</button>
          <p className="text-xs text-muted-foreground">Judge0 仍由服务端环境变量配置；此页不会启用主机代码执行。</p>
        </form>
      )}
    </main>
  );
}

export default function SettingsPage() {
  return <><SettingsForm /></>;
}
