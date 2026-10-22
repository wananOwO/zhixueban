'use client';

import { useEffect, useRef } from 'react';

/**
 * 2 秒轮询；页面隐藏（标签切换）时暂停，回到前台立即补一次。
 * tick 返回 false 表示停止轮询。
 */
export function usePolling(tick: () => Promise<boolean | void> | boolean | void, active: boolean) {
  const saved = useRef(tick);
  saved.current = tick;

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function run() {
      if (stopped || running) return;
      if (timer) clearTimeout(timer);
      if (document.hidden) {
        schedule();
        return;
      }
      running = true;
      let keepGoing: boolean | void;
      try {
        keepGoing = await saved.current();
      } catch {
        keepGoing = true;
      }
      running = false;
      if (stopped) return;
      if (keepGoing === false) {
        stopped = true;
        return;
      }
      schedule();
    }
    function schedule() {
      if (!stopped) timer = setTimeout(run, 2000);
    }
    function onVisible() {
      if (!document.hidden) void run();
    }

    void run();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active]);
}
