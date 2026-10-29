'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { DEMO_READ_ONLY_MSG } from '@/lib/demo';
import {
  defaultBaseUrl, settingsPatch, settingsSchema,
  type ModelTarget, type SecretKey, type Settings, type SettingsSnapshot,
} from '@/lib/settings';

interface Template { id: string; name: string; contentMd: string }
interface Notice { error: boolean; text: string }
const inputClass = 'mt-1 w-full min-w-0 rounded-md border border-border bg-background px-3 py-2 text-sm disabled:opacity-60';
const buttonClass = 'rounded-md border border-border px-4 py-2 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40';

async function requestJson(url: string, init?: RequestInit) {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(20000), cache: 'no-store' });
  } catch {
    throw new Error('网络请求失败或超时，请检查连接后重试。输入内容已保留。');
  }
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) throw new Error(body?.error ?? '服务返回异常，请稍后重试。');
  return body;
}

function Message({ notice }: { notice?: Notice | null }) {
  if (!notice) return null;
  return <p role={notice.error ? 'alert' : 'status'}
    className={`rounded-md px-3 py-2 text-sm ${notice.error ? 'bg-danger/5 text-danger' : 'bg-success/10 text-success'}`}>
    {notice.text}
  </p>;
}

export default function SettingsPage() {
  const [saved, setSaved] = useState<SettingsSnapshot | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [clearedKeys, setClearedKeys] = useState<SecretKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [models, setModels] = useState<Record<ModelTarget, string[]>>({ llm: [], embedding: [] });
  const [search, setSearch] = useState({ llm: '', embedding: '' });
  const [probe, setProbe] = useState<{ target: ModelTarget; action: 'list' | 'test' } | null>(null);
  const [modelNotices, setModelNotices] = useState<Partial<Record<ModelTarget, Notice>>>({});
  const [mcpDraft, setMcpDraft] = useState({ name: '', url: '' });
  const [mcpError, setMcpError] = useState('');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [newTpl, setNewTpl] = useState({ name: '', contentMd: '' });
  const [templateBusy, setTemplateBusy] = useState(false);
  const [templateNotice, setTemplateNotice] = useState<Notice | null>(null);
  const patch = draft && saved ? settingsPatch(draft, saved, clearedKeys) : {};
  const changed = Object.keys(patch).length > 0;
  const dirty = changed || !!(mcpDraft.name || mcpDraft.url || newTpl.name || newTpl.contentMd);
  const busy = saving || !!probe;
  const disabled = busy || !!saved?.readOnly;

  function acceptSettings(settings: SettingsSnapshot) {
    setSaved(settings);
    setDraft({ ...settings, llm_api_key: '', embedding_api_key: '' });
    setClearedKeys([]);
  }

  async function loadSettings() {
    setLoading(true);
    setNotice(null);
    try {
      acceptSettings(await requestJson('/api/settings'));
    } catch (error) {
      setNotice({ error: true, text: (error as Error).message });
    } finally {
      setLoading(false);
    }
  }

  async function loadTemplates() {
    try {
      const body = await requestJson('/api/prompts');
      setTemplates(body.templates);
      setTemplateNotice(null);
    } catch (error) {
      setTemplateNotice({ error: true, text: (error as Error).message });
    }
  }

  useEffect(() => {
    void loadSettings();
    void loadTemplates();
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const beforeNavigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(link instanceof HTMLAnchorElement) || link.target === '_blank') return;
      const url = new URL(link.href);
      if (url.origin === location.origin && url.pathname === location.pathname && url.search === location.search) return;
      if (!window.confirm('还有未保存的修改，离开会丢弃本次修改。继续离开？')) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', beforeNavigate, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', beforeNavigate, true);
    };
  }, [dirty]);

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setDraft((current) => current ? { ...current, [key]: value } : current);
    setNotice(null);
    if (key.startsWith('llm_') || key.startsWith('embedding_')) {
      setModelNotices({});
      if (!key.endsWith('_model')) setModels({ llm: [], embedding: [] });
    }
  }

  async function saveSettings() {
    if (!draft || !saved || disabled) return;
    if (mcpDraft.name || mcpDraft.url) {
      setNotice({ error: true, text: '请先将 MCP 服务器添加到列表，或清空未添加的内容，再保存设置。' });
      return;
    }
    const validated = settingsSchema.partial().safeParse(patch);
    if (!validated.success) {
      const issue = validated.error.issues[0];
      setNotice({ error: true, text: `${issue.path.join('.') || '配置'}：${issue.message}` });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const body = await requestJson('/api/settings', {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(validated.data),
      });
      acceptSettings(body.settings);
      setNotice({ error: false, text: '设置已保存。' });
    } catch (error) {
      setNotice({ error: true, text: (error as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function runModelAction(target: ModelTarget, action: 'list' | 'test') {
    if (disabled) return;
    setProbe({ target, action });
    setModelNotices((current) => ({ ...current, [target]: undefined }));
    try {
      const connectionPatch = Object.fromEntries(Object.entries(patch).filter(([key]) =>
        key.startsWith('llm_') || key.startsWith('embedding_')));
      const body = await requestJson('/api/settings/models', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target, action, settings: connectionPatch }),
      });
      if (action === 'list') {
        setModels((current) => ({ ...current, [target]: body.models }));
        setSearch((current) => ({ ...current, [target]: '' }));
      }
      setModelNotices((current) => ({ ...current, [target]: {
        error: false,
        text: action === 'list'
          ? (body.models.length ? `已拉取 ${body.models.length} 个模型，可搜索选择，也可手动输入。` : '服务返回了空列表，请手动填写模型名。')
          : target === 'embedding' ? `检索模型测试通过，返回 ${body.dimensions} 维向量。配置尚需点击保存。`
            : '对话模型测试通过。配置尚需点击保存。',
      } }));
    } catch (error) {
      setModelNotices((current) => ({ ...current, [target]: { error: true, text: (error as Error).message } }));
    } finally {
      setProbe(null);
    }
  }

  function addMcpServer() {
    if (!draft) return;
    const result = settingsSchema.shape.mcp_servers.safeParse([...draft.mcp_servers, mcpDraft]);
    if (!result.success) {
      setMcpError(result.error.issues[0].message);
      return;
    }
    update('mcp_servers', result.data);
    setMcpDraft({ name: '', url: '' });
    setMcpError('');
  }

  async function addTemplate() {
    if (!newTpl.name.trim() || !newTpl.contentMd.trim() || templateBusy) return;
    setTemplateBusy(true);
    setTemplateNotice(null);
    try {
      const body = await requestJson('/api/prompts', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(newTpl),
      });
      setTemplates((current) => [...current, { id: body.id, name: newTpl.name.trim(), contentMd: newTpl.contentMd.trim() }]);
      setNewTpl({ name: '', contentMd: '' });
      setTemplateNotice({ error: false, text: '提示词已添加。' });
    } catch (error) {
      setTemplateNotice({ error: true, text: (error as Error).message });
    } finally {
      setTemplateBusy(false);
    }
  }

  async function deleteTemplate(template: Template) {
    if (!window.confirm(`确定删除提示词“${template.name}”？`)) return;
    setTemplateBusy(true);
    setTemplateNotice(null);
    try {
      await requestJson(`/api/prompts?id=${encodeURIComponent(template.id)}`, { method: 'DELETE' });
      setTemplates((current) => current.filter((item) => item.id !== template.id));
      setTemplateNotice({ error: false, text: '提示词已删除。' });
    } catch (error) {
      setTemplateNotice({ error: true, text: (error as Error).message });
    } finally {
      setTemplateBusy(false);
    }
  }

  if (loading || !draft || !saved) {
    return <main id="main" className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="mb-6 text-2xl font-bold">设置</h1>
      {loading ? <p role="status">正在加载配置…</p> : <>
        <Message notice={notice} />
        <button type="button" onClick={() => void loadSettings()} className={`${buttonClass} mt-4`}>重新加载配置</button>
      </>}
    </main>;
  }

  return (
    <main id="main" className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold">设置</h1>
      <p className="mb-6 mt-2 text-sm leading-relaxed text-muted-foreground">
        填写接口地址和密钥，拉取模型并测试连接，最后保存。页面展示当前生效配置（含环境变量），只保存你修改的项目。
      </p>
      {saved.readOnly && <p role="status" className="mb-6 rounded-md bg-warning/10 p-3 text-sm">{DEMO_READ_ONLY_MSG}</p>}

      <form onSubmit={(event) => { event.preventDefault(); void saveSettings(); }} aria-busy={saving}>
        <fieldset disabled={disabled} className="min-w-0">
          <legend className="sr-only">模型与应用配置</legend>
          {(['llm', 'embedding'] as const).map((target) => {
            const label = target === 'llm' ? '对话' : '教材检索';
            const modelKey = target === 'llm' ? 'llm_model' : 'embedding_model';
            const urlKey = target === 'llm' ? 'llm_base_url' : 'embedding_base_url';
            const keyName: SecretKey = target === 'llm' ? 'llm_api_key' : 'embedding_api_key';
            const filtered = models[target].filter((model) => model.toLowerCase().includes(search[target].toLowerCase()));
            const clearing = clearedKeys.includes(keyName);
            return <section key={target} aria-labelledby={`${target}-heading`} className="mb-8">
              <h2 id={`${target}-heading`} className="mb-2 text-lg font-semibold">
                {target === 'llm' ? '1. 对话模型' : '2. 教材检索模型（Embedding）'}
              </h2>
              <p className="mb-3 text-sm text-muted-foreground">
                {target === 'llm' ? '负责课程设计、讲解和出题。' : '负责将教材建立为可检索索引；需选择支持 Embedding 的模型，不是聊天模型。'}
              </p>
              <div className="grid min-w-0 gap-4 rounded-md border border-border p-4">
                {target === 'llm' && <label className="block text-sm">
                  接口类型
                  <select value={draft.llm_provider} className={inputClass} onChange={(event) => {
                    const provider = event.target.value as Settings['llm_provider'];
                    setDraft((current) => current ? { ...current, llm_provider: provider, llm_base_url: defaultBaseUrl(provider), llm_model: '' } : current);
                    setModels({ llm: [], embedding: [] });
                    setModelNotices({});
                    setNotice(null);
                  }}>
                    <option value="openai-compatible">OpenAI 兼容接口（DeepSeek / 智谱 / OpenAI 等）</option>
                    <option value="anthropic">Anthropic Claude 原生接口</option>
                  </select>
                </label>}
                <label className="block text-sm">
                  {label} API 地址
                  <input type="url" value={draft[urlKey]} onChange={(event) => update(urlKey, event.target.value)}
                    placeholder={target === 'llm' ? defaultBaseUrl(draft.llm_provider) : '留空沿用对话 API 地址'}
                    autoComplete="off" spellCheck={false} className={inputClass} />
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {target === 'llm' ? '通常以 /v1 结尾；留空使用当前接口类型的默认地址。' : `留空沿用：${draft.llm_base_url || defaultBaseUrl(draft.llm_provider)}`}
                  </span>
                </label>
                <div>
                  <label className="block text-sm">
                    {label} API Key
                    <input type="password" value={draft[keyName]} onChange={(event) => update(keyName, event.target.value)}
                      placeholder={clearing ? '保存后清除当前密钥' : saved[keyName] ? `已配置 ${saved[keyName]}，留空保留` : target === 'llm' ? '请输入 API Key' : '未单独配置，留空沿用对话密钥'}
                      autoComplete="new-password" spellCheck={false} className={inputClass} />
                  </label>
                  {saved[keyName] && <button type="button" className="mt-2 text-xs text-danger underline" onClick={() => {
                    setClearedKeys((keys) => clearing ? keys.filter((key) => key !== keyName) : [...keys, keyName]);
                    update(keyName, '');
                  }}>{clearing ? '撤销清除密钥' : `清除已保存的${label}密钥`}</button>}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {clearing ? (target === 'llm' ? '保存后清除，包括环境变量中的密钥。' : '保存后清除独立密钥，恢复沿用对话密钥。') : '更换服务域名或接口类型后，请重新输入密钥。'}
                  </p>
                </div>
                <button type="button" onClick={() => void runModelAction(target, 'list')} className={`${buttonClass} justify-self-start`}>
                  {probe?.target === target && probe.action === 'list' ? '正在拉取…' : '拉取模型列表'}
                </button>
                {models[target].length > 0 && <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                  <label className="block min-w-0 text-sm">
                    搜索{label}模型
                    <input type="search" value={search[target]} onChange={(event) => setSearch((current) => ({ ...current, [target]: event.target.value }))}
                      placeholder="输入名称筛选" className={inputClass} />
                  </label>
                  <label className="block min-w-0 text-sm">
                    {label}模型列表
                    <select value="" className={inputClass} onChange={(event) => { if (event.target.value) update(modelKey, event.target.value); }}>
                      <option value="">{filtered.length ? `选择模型（${filtered.length} 个）` : '没有匹配的模型，可手动输入'}</option>
                      {filtered.map((model) => <option key={model} value={model}>{model}</option>)}
                    </select>
                  </label>
                </div>}
                <label className="block text-sm">
                  {label}模型名
                  <input value={draft[modelKey]} onChange={(event) => update(modelKey, event.target.value)}
                    placeholder="从列表选择，或手动输入完整模型名" autoComplete="off" spellCheck={false} className={inputClass} />
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" disabled={!draft[modelKey].trim() || disabled}
                    onClick={() => void runModelAction(target, 'test')} className={buttonClass}>
                    {probe?.target === target && probe.action === 'test' ? '正在测试…' : '测试连接'}
                  </button>
                  <span className="text-xs text-muted-foreground">会发送一次小请求，可能产生少量费用；不会自动保存。</span>
                </div>
                <Message notice={modelNotices[target]} />
              </div>
            </section>;
          })}
          {saved.hasIndexedContent && <p className="mb-6 rounded-md bg-warning/10 p-3 text-sm leading-relaxed">
            已有教材索引：更换检索模型或地址需要重建索引，本轮先保留它们。若只更换对话服务，请先将原检索地址填为独立地址；密钥可正常更新。
          </p>}

          <details className="mb-6 rounded-md border border-border p-4">
            <summary className="cursor-pointer font-medium">高级设置：MCP、执行器与 Obsidian</summary>
            <div className="mt-5 grid gap-6">
              <section aria-labelledby="mcp-heading">
                <h2 id="mcp-heading" className="mb-3 font-medium">MCP 服务器（只读工具）</h2>
                {draft.mcp_servers.length === 0 && <p className="mb-3 text-sm text-muted-foreground">尚未添加服务器，可跳过。</p>}
                <ul className="mb-3 grid gap-2">
                  {draft.mcp_servers.map((server) => <li key={server.name} className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm">
                    <span className="min-w-0 break-all">{server.name}<span className="mt-1 block text-xs text-muted-foreground">{server.url}</span></span>
                    <button type="button" aria-label={`移除 MCP 服务器 ${server.name}`} className="shrink-0 rounded p-2 text-danger"
                      onClick={() => update('mcp_servers', draft.mcp_servers.filter((item) => item.name !== server.name))}>
                      <Trash2 aria-hidden className="h-4 w-4" />
                    </button>
                  </li>)}
                </ul>
                <div className="grid min-w-0 gap-2 sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:items-end">
                  <label className="text-sm">MCP 名称
                    <input value={mcpDraft.name} onChange={(event) => setMcpDraft((current) => ({ ...current, name: event.target.value }))} className={inputClass} />
                  </label>
                  <label className="min-w-0 text-sm">MCP 地址
                    <input type="url" placeholder="https://example.com/mcp" value={mcpDraft.url}
                      onChange={(event) => setMcpDraft((current) => ({ ...current, url: event.target.value }))} className={inputClass} />
                  </label>
                  <button type="button" onClick={addMcpServer} className={buttonClass}>添加到列表</button>
                </div>
                {mcpError && <p role="alert" className="mt-2 text-sm text-danger">{mcpError}</p>}
                <p className="mt-2 text-xs text-muted-foreground">列表的添加、移除在点击“保存设置”后生效。</p>
              </section>
              <label className="block text-sm">编程题执行器地址（Judge0，可选）
                <input type="url" value={draft.judge0_url} onChange={(event) => update('judge0_url', event.target.value)}
                  placeholder="http://localhost:2358" className={inputClass} />
                <span className="mt-1 block text-xs text-muted-foreground">留空关闭独立执行器；Python 判题需要此服务，JS 题不受影响。</span>
              </label>
              <label className="block text-sm">Obsidian Vault 路径（本地部署，可选）
                <input value={draft.obsidian_vault_path} onChange={(event) => update('obsidian_vault_path', event.target.value)}
                  placeholder="D:\\Notes\\MyVault" className={inputClass} />
              </label>
            </div>
          </details>
        </fieldset>
        <div className="sticky bottom-0 z-10 mb-8 grid gap-3 border-t border-border bg-background py-4">
          <Message notice={notice} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span role="status" className={`text-sm ${changed || mcpDraft.name || mcpDraft.url ? 'text-warning' : 'text-muted-foreground'}`}>
              {saving ? '正在保存…' : changed || mcpDraft.name || mcpDraft.url ? '有未保存的修改' : '当前没有未保存的设置'}
            </span>
            <div className="flex gap-2">
              <button type="button" disabled={disabled || (!changed && !mcpDraft.name && !mcpDraft.url)} className={buttonClass}
                onClick={() => {
                  if (!window.confirm('放弃本次设置修改？')) return;
                  acceptSettings(saved);
                  setMcpDraft({ name: '', url: '' });
                  setMcpError('');
                  setModels({ llm: [], embedding: [] });
                  setModelNotices({});
                  setNotice(null);
                }}>放弃修改</button>
              <button type="submit" disabled={disabled || (!changed && !mcpDraft.name && !mcpDraft.url)}
                className="flex items-center gap-2 rounded-md bg-foreground px-5 py-2 text-sm text-background disabled:opacity-40">
                {saving && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
                保存设置
              </button>
            </div>
          </div>
        </div>
      </form>

      <section aria-labelledby="prompts-heading">
        <h2 id="prompts-heading" className="mb-2 text-lg font-semibold">自定义提示词</h2>
        <p className="mb-3 text-sm text-muted-foreground">提示词单独保存，不受上方“保存设置”按钮影响。</p>
        <Message notice={templateNotice} />
        {templateNotice?.error && <button type="button" onClick={() => void loadTemplates()} className={`${buttonClass} mt-2`}>重新加载提示词列表</button>}
        <fieldset disabled={templateBusy || saved.readOnly} className="mt-3 min-w-0">
          <legend className="sr-only">提示词管理</legend>
          <ul className="mb-4 grid gap-2">
            {templates.map((template) => <li key={template.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm">
              <span className="min-w-0 break-words">{template.name}</span>
              <button type="button" onClick={() => void deleteTemplate(template)} aria-label={`删除提示词 ${template.name}`}
                className="shrink-0 rounded p-2 text-danger"><Trash2 aria-hidden className="h-4 w-4" /></button>
            </li>)}
          </ul>
          <div className="grid gap-3 rounded-md border border-border p-4">
            <label className="text-sm">提示词名称
              <input value={newTpl.name} onChange={(event) => setNewTpl((current) => ({ ...current, name: event.target.value }))} className={inputClass} />
            </label>
            <label className="text-sm">提示词内容
              <textarea value={newTpl.contentMd} rows={4} placeholder="Markdown"
                onChange={(event) => setNewTpl((current) => ({ ...current, contentMd: event.target.value }))} className={inputClass} />
            </label>
            <button type="button" onClick={() => void addTemplate()} disabled={!newTpl.name.trim() || !newTpl.contentMd.trim() || templateBusy}
              className="flex items-center justify-center gap-2 rounded-md bg-foreground px-3 py-2 text-sm text-background disabled:opacity-40">
              {templateBusy ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Plus aria-hidden className="h-4 w-4" />}
              添加提示词
            </button>
          </div>
        </fieldset>
      </section>
    </main>
  );
}
