'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { ApiError, api } from '@/lib/api/client';
import { queryKeys, useMode } from '@/lib/api/queries';
import { useModelKey, type BrowserModelConfig } from '@/lib/stores/model-key';
import type { SettingsView } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/confirm';
import { Field, Input, Select } from '@/components/ui/field';
import { BlockError, BlockLoading } from '@/components/states/block-states';
import { PageHeader } from '@/components/shell/page-header';

type Provider = BrowserModelConfig['provider'];
interface Form {
  provider: Provider;
  baseUrl: string;
  apiKey: string;
  model: string;
  embeddingModel: string;
  embeddingBaseUrl: string;
  embeddingApiKey: string;
}
const EMPTY: Form = { provider: 'openai-compatible', baseUrl: '', apiKey: '', model: '', embeddingModel: '', embeddingBaseUrl: '', embeddingApiKey: '' };
const DEFAULT_BASE: Record<Provider, string> = { 'openai-compatible': 'https://api.deepseek.com/v1', anthropic: 'https://api.anthropic.com/v1' };

/**
 * 设置：模型供应商、地址、Key、模型。
 * 本地模式保存到本机数据库（Key 留空表示保持原值，不回显）；
 * 线上模式只保存在这个浏览器（localStorage），服务器只在需要模型的请求里临时使用。
 */
export function SettingsPage() {
  const mode = useMode();
  const online = mode.data?.mode === 'online';
  return (
    <>
      <PageHeader title="设置" description={online ? '生成课程、课件、题目和助教回答都用你自己的模型 Key。' : '本机使用的模型供应商。网页设置优先于环境变量；Key 只保存在本机数据库，不回显。'} />
      <div className="mt-6 grid gap-6">
        {mode.isPending ? <Section title="模型供应商"><BlockLoading lines={6} /></Section> : online ? <OnlineForm /> : <LocalForm />}
        <JudgeStatus />
      </div>
    </>
  );
}

/** 版式：左列标题与说明，右列纸面表单 */
function Section({ title, description, children, labelledBy }: { title: string; description?: React.ReactNode; children: React.ReactNode; labelledBy?: string }) {
  const id = useId();
  return (
    <section aria-labelledby={labelledBy ?? id} className="grid grid-cols-[minmax(0,20rem)_minmax(0,1fr)] gap-x-10 gap-y-3 max-lg:grid-cols-1">
      <div>
        <h2 id={labelledBy ?? id} className="font-serif text-h3 font-bold">{title}</h2>
        {description && <div className="mt-1 text-base text-muted">{description}</div>}
      </div>
      <div className="min-w-0 rounded-[var(--radius-paper)] bg-paper px-7 py-6 max-md:px-4 max-md:py-5">{children}</div>
    </section>
  );
}

function LocalForm() {
  const client = useQueryClient();
  const settings = useQuery({ queryKey: queryKeys.settings(), queryFn: () => api<SettingsView>('/settings') });
  const [form, setForm] = useState<Form>(EMPTY);
  const [message, setMessage] = useState('');
  useEffect(() => {
    const s = settings.data;
    if (!s) return;
    setForm({
      provider: (s.llm_provider as Provider) || 'openai-compatible',
      baseUrl: String(s.llm_base_url ?? ''),
      apiKey: '',
      model: String(s.llm_model ?? ''),
      embeddingModel: String(s.embedding_model ?? ''),
      embeddingBaseUrl: String(s.embedding_base_url ?? ''),
      embeddingApiKey: '',
    });
  }, [settings.data]);
  const save = useMutation({
    mutationFn: () => api<SettingsView>('/settings', {
      method: 'PATCH',
      body: {
        llm_provider: form.provider, llm_base_url: form.baseUrl, llm_api_key: form.apiKey, llm_model: form.model,
        embedding_model: form.embeddingModel, embedding_base_url: form.embeddingBaseUrl, embedding_api_key: form.embeddingApiKey,
      },
    }),
    onSuccess: data => { client.setQueryData(queryKeys.settings(), data); setMessage('已保存，之后的模型请求立即使用新配置。'); },
  });
  if (settings.isPending) return <Section title="模型供应商"><BlockLoading lines={6} label="正在读取设置" /></Section>;
  if (settings.error) return <Section title="模型供应商"><BlockError error={settings.error} onRetry={() => void settings.refetch()} /></Section>;
  const configured = settings.data?.llm_api_key_configured === true;
  const embeddingConfigured = settings.data?.embedding_api_key_configured === true;
  return (
    <Section title="模型供应商" description="更换供应商时请同时核对地址、Key 和模型。地址留空使用环境变量或协议默认值。这里只保存配置，不会发起付费调用。">
      <form className="grid gap-5" onSubmit={event => { event.preventDefault(); setMessage(''); save.mutate(); }}>
        <ProviderFields form={form} onChange={patch => { setForm(f => ({ ...f, ...patch })); setMessage(''); }} keyHint={configured ? '已配置；留空保持原值，输入新值替换' : '未配置'} keyPlaceholder={configured ? '已配置，留空保持原值' : 'sk-…'} online={false} />
        <fieldset className="grid gap-4 border-t border-rule pt-5">
          <legend className="text-sm text-muted">资料检索用的 Embedding（可选）</legend>
          <div className="grid grid-cols-3 gap-4 max-xl:grid-cols-1">
            <Field label="Embedding 模型" htmlFor="emb-model"><Input id="emb-model" value={form.embeddingModel} maxLength={300} placeholder="text-embedding-3-small" onChange={e => setForm(f => ({ ...f, embeddingModel: e.target.value }))} /></Field>
            <Field label="Embedding 地址" htmlFor="emb-base"><Input id="emb-base" value={form.embeddingBaseUrl} maxLength={2000} placeholder="留空使用上面的地址" onChange={e => setForm(f => ({ ...f, embeddingBaseUrl: e.target.value }))} /></Field>
            <Field label="Embedding Key" htmlFor="emb-key"><Input id="emb-key" type="password" autoComplete="new-password" value={form.embeddingApiKey} maxLength={4096} placeholder={embeddingConfigured ? '已配置，留空保持原值' : '留空使用上面的 Key'} onChange={e => setForm(f => ({ ...f, embeddingApiKey: e.target.value }))} /></Field>
          </div>
        </fieldset>
        <BlockError error={save.error} />
        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" variant="primary" disabled={save.isPending}>{save.isPending && <Loader2 className="animate-spin" aria-hidden />}保存设置</Button>
          <p role="status" className="text-sm text-muted">{message}</p>
        </div>
      </form>
    </Section>
  );
}

function OnlineForm() {
  const config = useModelKey(state => state.config);
  const setConfig = useModelKey(state => state.set);
  const clear = useModelKey(state => state.clear);
  const [form, setForm] = useState<Form>(EMPTY);
  const [message, setMessage] = useState('');
  // localStorage 只在浏览器可读：挂载后从存储填表
  useEffect(() => {
    setForm(f => (config ? { ...f, provider: config.provider, baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model } : { ...EMPTY }));
  }, [config]);
  const complete = form.apiKey.trim() && form.model.trim();
  return (
    <>
      <div className="rounded-[var(--radius-paper)] bg-zhu-tint px-6 py-4 text-base">
        <p className="font-medium text-ink">Key 只保存在这个浏览器里，服务器不写入任何文件。</p>
        <p className="mt-1 text-ink-soft">需要模型的请求会临时带上它：生成课程与内容时服务器只放在内存里，任务结束即删除。共用电脑用完请点「清除 Key」。</p>
      </div>
      <Section title="模型供应商" description="填你自己的 Key。费用由你的账户承担：一次课程方案生成约几十到一百次模型请求。">
        <form
          className="grid gap-5"
          onSubmit={event => {
            event.preventDefault();
            if (!complete) return;
            setConfig({ provider: form.provider, baseUrl: form.baseUrl.trim() || DEFAULT_BASE[form.provider], apiKey: form.apiKey.trim(), model: form.model.trim() });
            setMessage('已保存到本浏览器。');
          }}
        >
          <ProviderFields form={form} onChange={patch => { setForm(f => ({ ...f, ...patch })); setMessage(''); }} keyHint={config ? '已保存在本浏览器' : '必填'} keyPlaceholder="sk-…" online />
          <div className="flex flex-wrap items-center gap-4">
            <Button type="submit" variant="primary" disabled={!complete}>保存到本浏览器</Button>
            {config && (
              <ConfirmButton title="清除这个浏览器里的模型 Key？" description="清除后需要重新填写才能生成内容或使用助教。已生成的课程不受影响。" confirmLabel="清除" danger onConfirm={() => { clear(); setMessage('已清除。'); }}>
                清除 Key
              </ConfirmButton>
            )}
            <p role="status" className="text-sm text-muted">{message}</p>
          </div>
        </form>
      </Section>
    </>
  );
}

/** 供应商、地址、Key、模型（含拉取模型列表） */
function ProviderFields({ form, onChange, keyHint, keyPlaceholder, online }: {
  form: Form;
  onChange: (patch: Partial<Form>) => void;
  keyHint: string;
  keyPlaceholder: string;
  online: boolean;
}) {
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [note, setNote] = useState('');
  const list = useMutation({
    mutationFn: () => {
      if (online) {
        // 线上：用当前表单内容（未保存也可）作为 X-VL-Model，请求体不带 Key
        const header = encodeConfig({ provider: form.provider, baseUrl: form.baseUrl.trim() || DEFAULT_BASE[form.provider], apiKey: form.apiKey.trim(), model: form.model.trim() || 'list' });
        return fetchModels({}, header);
      }
      return fetchModels({ provider: form.provider, baseUrl: form.baseUrl, apiKey: form.apiKey });
    },
    onSuccess: result => {
      setModels(result.models);
      setNote(result.models.length ? `拉取到 ${result.models.length} 个模型${result.truncated ? '，供应商还有更多，可以手动填写' : ''}。` : '供应商没有返回可用模型，可以手动填写。');
    },
  });
  const reset = () => { setModels([]); setNote(''); list.reset(); };
  return (
    <>
      <div className="grid grid-cols-2 gap-4 max-xl:grid-cols-1">
        <Field label="供应商协议" htmlFor="provider">
          <Select id="provider" value={form.provider} onChange={e => { onChange({ provider: e.target.value as Provider }); reset(); }}>
            <option value="openai-compatible">OpenAI 兼容（OpenAI、DeepSeek、智谱等）</option>
            <option value="anthropic">Anthropic Claude</option>
          </Select>
        </Field>
        <Field label="API 地址" htmlFor="base-url" hint={online ? `只支持公网模型服务（HTTPS 默认端口）；留空使用 ${DEFAULT_BASE[form.provider]}` : `留空使用 ${DEFAULT_BASE[form.provider]}`}>
          <Input id="base-url" aria-describedby="base-url-hint" value={form.baseUrl} maxLength={2000} placeholder={DEFAULT_BASE[form.provider]} onChange={e => { onChange({ baseUrl: e.target.value }); reset(); }} />
        </Field>
      </div>
      <Field label="API Key" htmlFor="api-key" hint={keyHint}>
        <Input id="api-key" aria-describedby="api-key-hint" type="password" autoComplete="new-password" spellCheck={false} value={form.apiKey} maxLength={4096} placeholder={keyPlaceholder} onChange={e => { onChange({ apiKey: e.target.value }); reset(); }} />
      </Field>
      <div className="grid gap-3 border-t border-rule pt-5">
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" disabled={list.isPending || (online && !form.apiKey.trim())} onClick={() => list.mutate()}>
            {list.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}拉取模型列表
          </Button>
          <span className="text-sm text-muted">用上面填写的地址和 Key 查询，不必先保存；只读模型列表，不发起生成。</span>
        </div>
        <BlockError error={list.error} />
        {note && <p role="status" className="text-sm text-muted">{note}</p>}
        <div className="grid grid-cols-2 gap-4 max-xl:grid-cols-1">
          {models.length > 0 && (
            <Field label="选择模型" htmlFor="model-pick">
              <Select id="model-pick" value={models.some(m => m.id === form.model) ? form.model : ''} onChange={e => onChange({ model: e.target.value })}>
                <option value="">请选择…</option>
                {models.map(m => <option key={m.id} value={m.id}>{m.name === m.id ? m.id : `${m.name} · ${m.id}`}</option>)}
              </Select>
            </Field>
          )}
          <Field label="模型名称" htmlFor="model" hint="可以手动填写，例如 deepseek-chat">
            <Input id="model" aria-describedby="model-hint" value={form.model} maxLength={300} placeholder="deepseek-chat" onChange={e => onChange({ model: e.target.value })} />
          </Field>
        </div>
      </div>
    </>
  );
}

/** 与 modelHeaderValue 相同的编码，但用表单里尚未保存的配置 */
function encodeConfig(config: BrowserModelConfig): string {
  const bytes = new TextEncoder().encode(JSON.stringify(config));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function fetchModels(body: object, header?: string): Promise<{ models: { id: string; name: string }[]; truncated: boolean }> {
  if (!header) return api('/settings/models', { method: 'POST', body });
  // api() 的 modelHeader 取已保存的配置；这里要用表单里的，所以直接发请求
  const response = await fetch('/api/verified-learning/v1/settings/models', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-VL-Model': header },
    body: JSON.stringify(body),
  });
  const envelope = await response.json().catch(() => null) as { data?: unknown; error?: { code?: string; message?: string; retryable?: boolean } } | null;
  if (!response.ok) throw new ApiError(response.status, envelope?.error?.code ?? 'UNKNOWN', envelope?.error?.message ?? `请求失败（${response.status}）`, envelope?.error?.retryable ?? false);
  return envelope?.data as { models: { id: string; name: string }[]; truncated: boolean };
}

/** 判题服务：可用时列出语言；不可用时说明影响 */
function JudgeStatus() {
  const judge = useQuery({ queryKey: queryKeys.judge(), retry: false, queryFn: () => api<{ languages: { id: number; name: string }[] }>('/judge') });
  const id = useId();
  return (
    <Section title="判题服务" labelledBy={id} description="编程题由 Judge0 在隔离环境里运行判分，绝不在本机直接执行代码。判题服务由服务器环境变量配置。">
      {judge.isPending ? <BlockLoading lines={2} label="正在检查判题服务" /> : judge.error ? (
        <div className="text-base">
          <p className="font-medium">判题服务未配置：编程题无法生成和判分，选择题、填空题不受影响</p>
          <p className="mt-1 text-sm text-muted">{judge.error instanceof Error ? judge.error.message : String(judge.error)}</p>
        </div>
      ) : (
        <div className="text-base">
          <p className="font-medium">判题服务可用，支持 {judge.data!.languages.length} 种语言</p>
          <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-soft">{judge.data!.languages.map(l => <li key={l.id}>{l.name}</li>)}</ul>
        </div>
      )}
    </Section>
  );
}

