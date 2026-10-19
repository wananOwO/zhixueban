'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';

interface Template {
  id: string;
  name: string;
  contentMd: string;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [templates, setTemplates] = useState<Template[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [newTpl, setNewTpl] = useState({ name: '', contentMd: '' });

  useEffect(() => {
    fetch('/api/settings').then((r) => r.json()).then(setSettings);
    fetch('/api/prompts').then((r) => r.json()).then((b) => setTemplates(b.templates ?? []));
  }, []);

  async function saveSettings(patch: Record<string, unknown>) {
    setSaving(true);
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    setSaving(false);
    setMessage(res.ok ? '已保存' : '保存失败');
    setTimeout(() => setMessage(null), 2000);
  }

  async function addTemplate() {
    if (!newTpl.name.trim() || !newTpl.contentMd.trim()) return;
    await fetch('/api/prompts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(newTpl),
    });
    setNewTpl({ name: '', contentMd: '' });
    const b = await (await fetch('/api/prompts')).json();
    setTemplates(b.templates ?? []);
  }

  async function deleteTemplate(id: string) {
    await fetch(`/api/prompts?id=${id}`, { method: 'DELETE' });
    setTemplates((t) => t.filter((x) => x.id !== id));
  }

  return (
    <main id="main" className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="mb-8 text-2xl font-bold">设置</h1>
      {message && (
        <p role="status" className="mb-4 rounded-md bg-success/10 px-3 py-2 text-sm text-success">
          {message}
        </p>
      )}

      <section aria-labelledby="llm-h" className="mb-10">
        <h2 id="llm-h" className="mb-3 text-lg font-semibold">LLM 配置</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          通过环境变量 LLM_PROVIDER / LLM_MODEL / LLM_BASE_URL / LLM_API_KEY 配置（见 .env.example）。
          此处可保存 API Key 备忘（脱敏显示）。
        </p>
        <label className="block text-sm">
          LLM API Key
          <div className="mt-1 flex gap-2">
            <input
              type="password"
              defaultValue={typeof settings.llm_api_key === 'string' ? '' : ''}
              placeholder={typeof settings.llm_api_key === 'string' ? String(settings.llm_api_key) : '未配置'}
              onBlur={(e) => e.target.value && saveSettings({ llm_api_key: e.target.value })}
              className="flex-1 rounded-md border border-border bg-background px-3 py-2"
            />
          </div>
        </label>
      </section>

      <section aria-labelledby="mcp-h" className="mb-10">
        <h2 id="mcp-h" className="mb-3 text-lg font-semibold">MCP 服务器（仅只读工具）</h2>
        <MCPEditor
          servers={(settings.mcp_servers as { name: string; url: string }[]) ?? []}
          onChange={(servers) => void saveSettings({ mcp_servers: servers })}
        />
      </section>

      <section aria-labelledby="obsidian-h" className="mb-10">
        <h2 id="obsidian-h" className="mb-3 text-lg font-semibold">Obsidian（本地部署时生效）</h2>
        <label className="block text-sm">
          Vault 路径
          <input
            defaultValue={typeof settings.obsidian_vault_path === 'string' ? settings.obsidian_vault_path : ''}
            placeholder="例：D:\\Notes\\MyVault"
            onBlur={(e) => e.target.value && saveSettings({ obsidian_vault_path: e.target.value })}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
          />
        </label>
      </section>

      <section aria-labelledby="prompts-h">
        <h2 id="prompts-h" className="mb-3 text-lg font-semibold">自定义提示词</h2>
        <ul className="mb-4 grid gap-2">
          {templates.map((t) => (
            <li key={t.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
              <span>{t.name}</span>
              <button
                type="button"
                onClick={() => void deleteTemplate(t.id)}
                aria-label={`删除提示词 ${t.name}`}
                className="text-danger hover:opacity-70"
              >
                <Trash2 aria-hidden className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
        <div className="grid gap-2 rounded-md border border-border p-3">
          <input
            aria-label="提示词名称"
            placeholder="名称"
            value={newTpl.name}
            onChange={(e) => setNewTpl((s) => ({ ...s, name: e.target.value }))}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <textarea
            aria-label="提示词内容"
            placeholder="提示词内容（Markdown）"
            rows={3}
            value={newTpl.contentMd}
            onChange={(e) => setNewTpl((s) => ({ ...s, contentMd: e.target.value }))}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => void addTemplate()}
            className="flex items-center justify-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-sm text-background"
          >
            <Plus aria-hidden className="h-4 w-4" />
            添加提示词
          </button>
        </div>
      </section>

      {saving && (
        <span role="status" className="sr-only">
          正在保存
        </span>
      )}
    </main>
  );
}

function MCPEditor({
  servers,
  onChange,
}: {
  servers: { name: string; url: string }[];
  onChange: (servers: { name: string; url: string }[]) => void;
}) {
  const [draft, setDraft] = useState({ name: '', url: '' });
  return (
    <div className="grid gap-2">
      {servers.map((s) => (
        <div key={s.name} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
          <span>
            {s.name} <span className="text-xs text-muted-foreground">{s.url}</span>
          </span>
          <button
            type="button"
            aria-label={`删除 MCP 服务器 ${s.name}`}
            onClick={() => onChange(servers.filter((x) => x.name !== s.name))}
            className="text-danger hover:opacity-70"
          >
            <Trash2 aria-hidden className="h-4 w-4" />
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <input
          aria-label="MCP 服务器名称"
          placeholder="名称"
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          className="w-32 rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
        <input
          aria-label="MCP 服务器地址"
          placeholder="http://…"
          value={draft.url}
          onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
          className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() => {
            if (draft.name && draft.url) {
              onChange([...servers, draft]);
              setDraft({ name: '', url: '' });
            }
          }}
          className="rounded-md bg-foreground px-3 py-2 text-sm text-background"
        >
          添加
        </button>
      </div>
    </div>
  );
}
