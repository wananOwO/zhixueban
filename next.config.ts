import type { NextConfig } from 'next';

// Pi运行时包含Node动态加载；服务端直接使用安装包，避免打包器改写动态依赖。
const config: NextConfig = {
  serverExternalPackages: ['@earendil-works/pi-agent-core', '@earendil-works/pi-ai'],
};
export default config;
