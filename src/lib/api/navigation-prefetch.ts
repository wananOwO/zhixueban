'use client';

import type { QueryClient } from '@tanstack/react-query';
import { listQueries, queryKeys } from './queries';
import type { ModeView } from './types';

/** 仅在登录后按导航意图预热只读列表；失败交给目标页显示，不阻塞导航。 */
export async function prefetchNavigation(client: QueryClient, href: string): Promise<void> {
  if (client.getQueryData(queryKeys.access()) !== true) return;
  const requests: Promise<void>[] = [];
  if (href === '/' || href === '/library') requests.push(client.prefetchQuery(listQueries.books()));
  if (href === '/' || href === '/courses') requests.push(client.prefetchQuery(listQueries.courses()));
  if (href === '/' || href === '/courses' || href === '/drafts') requests.push(client.prefetchQuery(listQueries.drafts()));
  if (href === '/') requests.push(client.prefetchQuery(listQueries.jobs()));
  if (href === '/settings' && client.getQueryData<ModeView>(queryKeys.mode())?.mode === 'local') {
    requests.push(client.prefetchQuery(listQueries.settings()));
  }
  await Promise.all(requests);
}
