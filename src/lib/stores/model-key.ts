'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { registerModelHeader } from '@/lib/api/client';

/**
 * 线上模式的模型配置：只保存在本浏览器 localStorage（键 vl-model）。
 * 需要模型的请求经 api(..., { modelHeader: true }) 放进 X-VL-Model 头；服务器只放内存。
 */
export interface BrowserModelConfig {
  provider: 'openai-compatible' | 'anthropic';
  baseUrl: string;
  apiKey: string;
  model: string;
}

interface ModelKeyState {
  config: BrowserModelConfig | null;
  set: (config: BrowserModelConfig) => void;
  clear: () => void;
}

export const useModelKey = create<ModelKeyState>()(
  persist(
    set => ({
      config: null,
      set: config => set({ config }),
      clear: () => set({ config: null }),
    }),
    { name: 'vl-model', storage: createJSONStorage(() => localStorage), partialize: state => ({ config: state.config }) },
  ),
);

/** base64url(JSON)，与服务端 parseModelHeader 对应；未保存时为 null */
export function modelHeaderValue(): string | null {
  const config = useModelKey.getState().config;
  if (!config) return null;
  const bytes = new TextEncoder().encode(JSON.stringify(config));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

registerModelHeader(modelHeaderValue);
