import { defineConfig, devices } from '@playwright/test';

/**
 * 端到端测试：页面与真实 Next 服务交互，业务接口在每个用例里用 page.route 模拟，
 * 不调用真实模型、不读写用户数据库。服务器使用 scripts/e2e-server.mjs 建立的一次性测试库。
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3101',
    locale: 'zh-CN',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: 'node scripts/e2e-server.mjs',
    url: 'http://127.0.0.1:3101/api/verified-learning/v1/mode',
    reuseExistingServer: !process.env.CI,
    // 包含一次生产构建
    timeout: 600_000,
  },
});
