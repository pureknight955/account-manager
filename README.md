# 账号与租客管理系统 (Account & Tenant Manager)

这是一个使用 Vanilla JavaScript 和 Vite 构建的单页面应用（SPA）。本地模式使用 LocalStorage；配置 Supabase 后，可登录云端账号并在不同设备间同步同一份由主密码完整加密的数据。该系统用于管理多平台订阅账号、成员缴费、银行卡余额和收支流水。

## 🌟 核心功能特性

### 1. 仪表盘 (Dashboard)
- **智能提醒系统**：动态显示近期（如 7 日内，可自定义）需要续费的账号、需要催收租金的租客。
- **席位空缺追踪**：自动计算团队版/企业版账号的剩余可用席位，并提前预警明确不续租或即将逾期可能空出的席位。
- **月度财务统计**：自动计算当月的总支出（订阅费）、总收入（租客交租）以及净利润，支持美元/人民币汇率动态转换。

### 2. 账号管理 (Accounts)
- **多平台支持**：支持 ChatGPT、Claude、Midjourney、Netflix 等多种预设账号类型，支持普通版/Plus版/团队版/企业版等不同订阅层级。
- **状态追踪**：记录账号的封号情况、退款状态、登录设备、以及绑定的扣费银行卡。
- **详情与历史账单**：在账号详情页可以直接查看该账号的所有历史系统扣费账单，并支持一键修改扣费金额、切换扣费银行卡或删除账单，差额会自动同步至银行卡余额。

### 3. 租客/拼车管理 (Team Members)
- **周期计费逻辑**：基于租客的“邀请加入日期（Invite Date）”自动推算每个月的缴费周期（第 N 期）和应缴日期。
- **一键确认收款**：直观展示租客当前的缴费状态（已缴费、即将到期、欠费告警、已退出）。
- **续租意向追踪**：租客可以选择“下期不续租”，系统会提前在首页的空缺预警中提示车主寻找替补。

### 4. 钱包与卡包管理 (Wallet)
- **实体与虚拟卡管理**：记录各个银行卡的尾号、余额、和充值流水。
- **自动扣费平衡**：当账号触发月度续费时，系统会自动从其绑定的银行卡中扣除对应金额（美元）。
- **流水推导余额**：卡片余额统一按“初始余额 + 充值 - 卡片来源账单”计算，修改账单或充值后会自动重算。
- **常驻“非卡片”记账**：对于使用礼品卡、他人代付等非本人银行卡的交易，系统提供了一个常驻的“非卡片”占位符进行统一收纳，方便后续编辑或对账。

### 5. 系统设置与数据安全 (Settings)
- **深色/浅色模式**：支持根据系统设置自动切换，或手动固定深色/浅色主题。
- **个性化参数**：可自定义汇率（用于展示 RMB 收入）和提前提醒天数（默认 7 天）。
- **本地数据导入/导出**：所有数据均完全保存在浏览器的 LocalStorage 中，提供一键导出为 JSON 文件备份，和从 JSON 文件恢复的功能，保护隐私安全。
- **自动锁定**：解锁后可设置 5-120 分钟无操作自动锁定；修改主密码时会同步重新加密已有账号密码。
- **可选云端同步**：整份备份由主密码使用 AES-256-GCM 加密后上传到 Supabase；数据库使用用户级 RLS 隔离，并通过版本号阻止多设备静默覆盖。
- **云端账号恢复**：云端密码至少 6 位，可通过 Supabase 邮件链接重设；主密码是云端密文的解密密钥，无法通过邮件找回。

> 安全边界：云端只保存整份加密密文，主密码不会上传；解锁后的本机浏览器仍保留工作缓存。手动导出的 JSON 备份包含明文业务数据，应按敏感文件保管。本工具适合个人自用，但不等同于经过专业审计的密码管理器。

---

## 📁 目录与文件框架逻辑

整个项目采用了轻量级的模块化 Vanilla JS 架构，按功能将逻辑拆分：

### 根目录
- `index.html`：项目的主入口，定义了左侧侧边栏（Sidebar）和右侧主内容区（`#app-content`）的骨架结构。
- `package.json` / `vite.config.js`：前端构建工具 Vite 的配置及依赖清单。
- `start_app.bat`：Windows 下的双击启动脚本。

### `src/` 核心代码
- **`main.js`**
  - **职责**：整个应用的初始化入口和路由控制器。
  - **逻辑**：监听左侧导航菜单的点击事件，利用 `window.navigateTo(page)` 函数动态清空主内容区，并加载对应页面的 `render(container)` 函数，实现无刷新页面切换。

- **`config.js`**
  - **职责**：系统静态配置。
  - **逻辑**：统一定义支持的账号类型、订阅级别、支持的银行卡品牌，充值方式等常量，方便全局统一调用和后期扩展。

### `src/utils/` 工具库
- **`storage.js`** 
  - **职责**：数据持久化层，封装所有与 LocalStorage 交互的 CRUD（增删改查）操作。
  - **核心系统**：包含核心的 `autoGenerateBillingRecords` 自动查重生成账单逻辑，以及 `editBillingRecord` 账单修改时的卡片余额退还与重新扣款的平衡逻辑。
- **`helpers.js`**
  - **职责**：纯函数工具箱。
  - **逻辑**：处理所有与时间相关的复杂计算（如 `daysUntil` 计算倒计时，`getCurrentPeriod` 计算租客租期），货币格式化，邮箱打码显示等。

### `src/pages/` 页面渲染逻辑
每个文件对应系统的一个功能页面，对外暴露 `render(container)` 方法：
- **`dashboard.js`**：整合各个模块的数据，渲染首页的五大面板（空缺、催收、续费、总览、财务）。
- **`accounts.js`**：渲染账号列表，提供网格/列表视图切换、搜索、筛选功能。
- **`account-detail.js`**：渲染账号详情视图，包含账号基础信息编辑、租客（Member）的增删改查、收款确认，以及历史账单弹窗的实时编辑与删除。
- **`wallet.js`**：渲染卡包列表、银行卡详情、充值流水，和全局账单修改。
- **`settings.js`**：渲染全局设置，处理 JSON 数据的导出下载和上传解析读取。

### `src/styles/` 样式系统
采用分层的纯 CSS 架构，利用 CSS Variables 实现主题切换：
- `variables.css`：定义全局颜色、间距、圆角等变量，包含 `:root` (浅色) 和 `[data-theme='dark']` (深色) 两套配色方案。
- `base.css`：HTML 标签的基础 Reset，滚动条美化，全局排版。
- `components.css`：复用组件样式，如按钮 (`.btn`)，徽章 (`.badge`)，输入框 (`.form-input`)，弹窗 (`.modal`)，轻提示 (`.toast`)。
- `layout.css`：定义侧边栏和主容器的布局（Flex/Grid）。
- `pages.css`：专门针对仪表盘 Widget、账号详情表单等特定页面区域的样式。

---

## 🚀 本地开发与运行

1. 安装依赖：`npm install`
2. 启动服务：`npm run dev` 或者直接双击项目根目录下的 `start_app.bat`
3. 编译打包：`npm run build` （产出物在 `dist/` 目录下，可直接部署到任何静态服务器如 Nginx / Vercel）
4. 运行核心逻辑测试：`npm test`

## ☁️ Supabase 与 GitHub Pages 部署

1. 在 Supabase SQL Editor 执行 `supabase/schema.sql`，创建加密保险库表和 RLS 策略。
2. 复制 `.env.example` 为 `.env.local`，填写 Supabase Project URL 与 Publishable Key。不要提交 `.env.local`。
3. 在 GitHub 仓库的 `Settings > Secrets and variables > Actions > Variables` 添加：
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
4. 在 `Settings > Pages` 将 Source 设为 `GitHub Actions`，推送 `main` 分支后由工作流自动测试、构建和发布。
5. 将最终 Pages 地址加入 Supabase Auth 的 Site URL 和 Redirect URLs。
6. 执行 `supabase/schema.sql` 后，在 SQL Editor 单独写入注册暗号的 bcrypt 哈希，并在 `Authentication > Hooks` 将 `Before User Created` 指向 `public.hook_require_registration_code`。暗号本身不得提交到公开仓库。

   ```sql
   insert into private.registration_gate (id, code_hash)
   values (1, extensions.crypt('<在此输入暗号>', extensions.gen_salt('bf', 12)))
   on conflict (id) do update set code_hash = excluded.code_hash;
   ```

已有本地数据时，应先在原来的 `http://localhost:5173/` 页面创建或登录云端账号并输入原主密码，确认首次同步完成后再到 Pages 地址登录。验证邮件会回到发起注册的页面，避免从空白设备创建一份新的云端数据。

仓库已忽略 `.env.local`、本地备份、日志、`node_modules` 和 `dist`。Supabase Publishable Key 可以出现在前端构建中，真正的数据访问边界由登录会话和 RLS 策略提供；不要把 `service_role` key 放入前端或 GitHub Actions 变量。
