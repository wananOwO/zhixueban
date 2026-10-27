import type { NextConfig } from 'next';

// Pi运行时包含Node动态加载；服务端直接使用安装包，避免打包器改写动态依赖。
const config: NextConfig = {
  serverExternalPackages: ['@earendil-works/pi-agent-core', '@earendil-works/pi-ai'],
  async headers() {
    return [
      {
        // SSE 任务流：告诉 Nginx 不要缓冲，事件才能实时到达浏览器
        source: '/api/verified-learning/v1/jobs/:id/stream',
        headers: [{ key: 'X-Accel-Buffering', value: 'no' }],
      },
    ];
  },
};
export default config;
