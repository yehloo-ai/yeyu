# Contributing

欢迎通过 Issue 或 Pull Request 贡献。

- Node.js 20+，先执行 `npm ci`。
- 提交前执行 `npm test`、`npm run check`、`npm run test:browser`、`npm run format:check`。
- 浏览器测试需先执行 `npx playwright install chromium`。
- 保持运行时无服务器、无远程脚本、无第三方追踪；新增权限需说明用途。
- 示例和测试使用通用演示数据。不要提交个人入口、内网网址、登录内容、真实邮箱或迁移配置。
- Issue 中提供复现步骤、系统和 Chrome 版本，不上传敏感配置备份。

`npm run package` 生成 ZIP，版本号来自 `extension/manifest.json`。
