// 应用入口
import { initApp } from './app.js';

// 等待 DOM 加载完成后初始化
document.addEventListener('DOMContentLoaded', async () => {
  await initApp();
});
