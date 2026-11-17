'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { registerEmbeddingHeader, registerModelHeader, registerVisionHeader } from '@/lib/api/client';

/**
 * 线上模式的模型凭据：只保存在本浏览器 localStorage（键 vl-model）。
 * 按用途分三个独立请求头：X-VL-Model、X-VL-Embedding、X-VL-Vision；服务器只放内存。
 */
export interface BrowserModelConfig {
  provider: 'openai-compatible' | 'anthropic';
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface BrowserEmbeddingConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface BrowserVisionConfig {
  provider: 'openai-compatible' | 'anthropic';
  baseUrl: string;
  apiKey: string;
  model: string;
}

interface ModelKeyState {
  config: BrowserModelConfig | null;
  embedding: BrowserEmbeddingConfig | null;
  vision: BrowserVisionConfig | null;
  set: (config: BrowserModelConfig) => void;
  setEmbedding: (embedding: BrowserEmbeddingConfig | null) => void;
  setVision: (vision: BrowserVisionConfig | null) => void;
  clear: () => void;
}

function toBase64Url(payload: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const useModelKey = create<ModelKeyState>()(
  persist(
    set => ({
      config: null,
      embedding: null,
      vision: null,
      set: config => set({ config }),
      setEmbedding: embedding => set({ embedding }),
      setVision: vision => set({ vision }),
      clear: () => set({ config: null, embedding: null, vision: null }),
    }),
    {
      name: 'vl-model',
      storage: createJSONStorage(() => localStorage),
      partialize: state => ({ config: state.config, embedding: state.embedding, vision: state.vision }),
    },
  ),
);

/** base64url(JSON)，与服务端 parseModelHeader 对应；未保存时为 null */
export function modelHeaderValue(): string | null {
  const config = useModelKey.getState().config;
  return config ? toBase64Url(config) : null;
}

/** base64url(JSON)，与服务端 parseEmbeddingHeader 对应；未单独配置时不假设聊天模型支持 Embedding */
export function embeddingHeaderValue(): string | null {
  const embedding = useModelKey.getState().embedding;
  return embedding ? toBase64Url(embedding) : null;
}

/** base64url(JSON)，与服务端 parseVisionHeader 对应；未单独配置时可回退聊天模型 */
export function visionHeaderValue(): string | null {
  const { vision, config } = useModelKey.getState();
  const effective = vision ?? config;
  return effective ? toBase64Url(effective) : null;
}

registerModelHeader(modelHeaderValue);
registerEmbeddingHeader(embeddingHeaderValue);
registerVisionHeader(visionHeaderValue);
