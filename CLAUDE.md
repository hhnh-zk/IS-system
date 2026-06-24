# CLAUDE.md

本文档为 Claude Code（claude.ai/code）在此仓库中工作时提供指导。

## 开发命令

```bash
npm install          # 安装依赖
npm run dev          # 启动开发服务器（Express + Vite 中间件，端口 3000）
npm run build        # 构建前端生产版本（Vite）
npm run preview      # 本地预览生产构建
npm run clean        # 删除 dist 目录
npm run lint         # 类型检查（tsc --noEmit）
```

- `dev` 使用 `tsx` 执行 Express 服务器（`api/index.ts`），服务器会自动启动 Vite 中间件以支持 HMR
- 生产模式下，Express 从 `dist/` 目录提供静态文件

## 架构概述

这是一个**认知连续性实验平台**（项目名 "IS" — Intent Summary），旨在研究**结构化的意图摘要能否帮助用户在被中断任务后快速恢复认知状态**。系统采用单服务器架构，React 前端通过 Express 后端提供服务。

### 项目文件地图

```
IS/
├── api/index.ts              # Express 服务器（API 路由、数据库、AI、Vite 中间件）
├── src/
│   ├── main.tsx              # React 入口点
│   ├── App.tsx               # 主应用组件（实验编排）
│   ├── types.ts              # TypeScript 接口（Message, IntentSummaryData, ChatSession）
│   ├── index.css             # Tailwind v4 导入 + 自定义主题
│   ├── components/
│   │   ├── ChatMessage.tsx   # 消息气泡（Markdown 渲染）
│   │   └── IntentSummary.tsx # 侧边栏面板（展示结构化摘要）
│   └── services/
│       └── ai.ts             # 后端 API 的客户端封装
├── index.html                # Vite 入口 HTML
├── vite.config.ts            # Vite 配置（React、Tailwind、路径别名）
├── tsconfig.json             # TypeScript 配置
├── vercel.json               # Vercel 部署路由重写规则
├── metadata.json             # claude.ai/code 项目元数据
├── .env.example              # 环境变量模板
└── .claude/settings.local.json  # 本地权限配置
```

### 前端（React 19 + TypeScript）

- **入口**：`src/main.tsx` → `src/App.tsx`
- **组件**：
  - [ChatMessage.tsx](src/components/ChatMessage.tsx) — 使用 `react-markdown` 渲染用户/助手消息，从 `lucide-react` 显示 `User`/`Bot` 图标
  - [IntentSummary.tsx](src/components/IntentSummary.tsx) — 滑入式侧边栏，包含四个部分：任务进度回溯、用户偏好识别、待处理问题提示、建议后续步骤
- **服务**：[src/services/ai.ts](src/services/ai.ts) — 对后端 API 端点的 `fetch()` 轻量封装
- **样式**：通过 `@tailwindcss/vite` 插件使用 Tailwind CSS v4，在 `index.css` 中用 `@theme` 指令定制主题（Inter 字体、JetBrains Mono 等宽字体）
- **动画**：`motion`（Framer Motion v12）用于入口弹窗、中断覆盖层和摘要侧边栏的过渡
- **图标**：所有 UI 图标来自 `lucide-react`
- **路径别名**：`@/*` 映射到项目根目录（在 `vite.config.ts` 和 `tsconfig.json` 中配置）
- **CSS 工具函数**：`cn()` 函数组合 `clsx` + `tailwind-merge` 实现条件类名合并（在 `ChatMessage.tsx` 和 `IntentSummary.tsx` 中均有定义）

### 后端（Express + PostgreSQL + OpenAI）

- **服务器**：`api/index.ts` 运行在 3000 端口
  - 启动后立即监听端口，然后异步初始化依赖
  - `openai`、`pg`、`vite` 使用动态导入进行初始化
  - 全局 Express 错误中间件返回 JSON 格式错误
- **数据库**：通过 `pg` 驱动连接 PostgreSQL，SSL 配置为 `rejectUnauthorized: false`
  - 首次连接时自动建表（无迁移系统）
  - 表：`messages`（聊天历史 + 事件）、`summaries`（生成的意图摘要）
- **AI 集成**：使用 DeepSeek API 的 `deepseek-chat` 模型（兼容 OpenAI SDK）
  - 系统提示词：旅行助手，提供详细的旅行方案
- **API 版本号**：`"1.1.4-ORDER-FIX"`（硬编码在 `api/index.ts` 中）

### 部署（Vercel）

- `vercel.json` 重写规则：`/api/(.*)` → `/api/index.ts`，所有其他路由 → `/index.html`
- 通过 Vercel 的 Node.js 运行时使用无服务器函数

## 环境配置

必需的环境变量（见 `.env.example`）：
```
DATABASE_URL=         # PostgreSQL 连接字符串（例如 postgres://user:pass@host:5432/db）
DEEPSEEK_API_KEY=     # DeepSeek API 密钥，用于 deepseek-chat 模型访问
```

- **注意**：代码库使用 `DEEPSEEK_API_KEY` 配合 DeepSeek API（兼容 OpenAI SDK），`baseURL` 设置为 `https://api.deepseek.com`。
- 数据库使用 SSL 并设置 `rejectUnauthorized: false`，以便兼容托管式 PostgreSQL 提供商。

## 实验设计

### 分组设置

首次加载时弹出模态框，要求用户输入：
- **参与者 ID**（自由文本，如 "S01"）
- **实验组选择**：
  - **Group 1**："History" — 中断后仅保留对话历史
  - **Group 2**："IS"（意图摘要）— 中断后额外显示结构化摘要侧边栏

### 中断逻辑（在 [App.tsx](src/App.tsx) 中）

**触发条件**（每次助手回复后检查）：
1. 用户已发送 ≥3 条消息
2. AI 已提供"完整"的旅行方案（通过 `POST /api/check-interruption` 检测）
3. 完整方案标准：≥2 个目的地、特色对比、逐日行程、预算估算

**中断流程**：
1. 条件满足 + 用户开始输入 → 触发 `simulateInterruption()`
2. 显示全屏覆盖层（风景图 + 180 秒倒计时）
3. **仅 Group 2**：倒计时期间后台调用 `POST /api/summary` 生成意图摘要
4. 180 秒后：覆盖层消失，Group 2 的 `showSummary` 设为 `true`
5. 摘要侧边栏从右侧滑入（仅 Group 2）
6. 后续消息携带 `isInterruptionSuccess: true` 标志写入数据库

**状态保护**：
- `isInterruptionTriggered` ref 防止重复触发
- `isCheckingCondition` ref 防止并发中断检查
- `hasInterrupted` 状态确保中断在每次会话中只触发一次

### 意图摘要结构

```typescript
interface IntentSummaryData {
  progress: string[];           // 已讨论的完成要点
  preferences: string;          // 用户偏好和关注点
  pendingIssues: string;        // 核心未解决问题/冲突
  suggestedNextSteps: string[]; // 推荐的下一步行动
}
```

### 日志记录

所有交互都记录到 PostgreSQL 的 `messages` 表：
- `participant_id`、`group_id`（'1' 或 '2'）
- 消息 `role`（'user'、'model' 或 'event'）
- `is_interruption_success` 标志（1 = 中断后的首条消息）
- 通过 `POST /api/log-event` 记录实验事件（如 "Interruption Ended"）

## 数据库 Schema

```sql
-- messages: 存储所有聊天消息和实验事件
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  participant_id TEXT,
  group_id TEXT,
  role TEXT,                     -- 'user', 'model', 或 'event'
  content TEXT,
  timestamp BIGINT,
  is_interruption_success INTEGER DEFAULT 0
);

-- summaries: 存储为 Group 2 生成的意图摘要
CREATE TABLE summaries (
  id SERIAL PRIMARY KEY,
  participant_id TEXT,
  group_id TEXT,
  data TEXT,                    -- DeepSeek 返回的 JSON 摘要
  timestamp BIGINT
);
```

## API 端点

所有端点位于 [api/index.ts](api/index.ts)：

| 方法 | 路径 | 描述 |
|--------|------|------|
| `GET` | `/api/ping` | 健康检查（返回 `"pong"`） |
| `GET` | `/api/health` | 详细状态（DB/AI/Vite 初始化状态） |
| `POST` | `/api/chat` | 通过 DeepSeek 生成 AI 回复（旅行助手系统提示词） |
| `POST` | `/api/summary` | 根据对话历史生成结构化意图摘要 |
| `POST` | `/api/check-interruption` | 判断旅行方案是否完整到足以触发中断 |
| `GET` | `/api/messages` | 获取消息历史（可选 `?participantId=` 过滤） |
| `POST` | `/api/log-event` | 将实验事件记录到 messages 表 |

**系统提示词**：旅行助手必须提供详细回复，包含：1) ≥2 个目的地，2) 特色对比，3) 逐日行程，4) 住宿预算估算。

## 前端组件深度解析

### [App.tsx](src/App.tsx) 核心状态

```typescript
messages: Message[]              // 对话历史
isInterrupted: boolean           // 中断覆盖层是否激活
interruptionTimer: number        // 180 秒倒计时（每秒递减）
summary: IntentSummaryData|null  // 生成的摘要（仅 Group 2）
showSummary: boolean             // 是否显示摘要侧边栏
participantId: string            // 实验参与者标识
groupId: '1' | '2' | ''         // 实验分组
hasInterrupted: boolean          // 是否已触发中断
isConditionMet: boolean          // 是否满足中断条件
isInterruptionSuccess: boolean   // 标记中断后首条消息的标志
```

### 状态流转

1. 入口弹窗 → 设置 `participantId` + `groupId`
2. 用户输入 → `handleSend()` → `POST /api/chat` → 追加助手回复
3. 每次助手回复后（≥3 轮用户消息）→ `checkInterruption()` → `POST /api/check-interruption`
4. 条件满足 + 用户开始输入 → `simulateInterruption()` → 全屏覆盖层 + 180 秒倒计时
5. 仅 Group 2 → 倒计时期间后台 `POST /api/summary`
6. 倒计时归零 → 覆盖层关闭 → Group 2 显示摘要侧边栏
7. 下一条用户消息携带 `isInterruptionSuccess: true`

### 处理的 UI 状态

- **加载中**：等待 AI 回复时显示骨架屏脉冲动画
- **错误**：红色横幅显示错误信息 + 关闭按钮（API 错误、网络问题）
- **空状态**：欢迎页面带示例提示按钮
- **中断中**：全屏覆盖层（背景图 + 倒计时 + 组状态文字）
- **边界情况**：中断期间禁用发送，使用 ref 防止竞态条件

### [ChatMessage.tsx](src/components/ChatMessage.tsx)

- 根据角色使用不同样式渲染消息（用户白色背景，助手 zinc-50 背景）
- 使用 `react-markdown` 渲染内容
- `cn()` 工具函数（`clsx` + `tailwind-merge`）处理条件类名
- 用户消息：`User` 图标（zinc-100 背景）| 助手消息：`Bot` 图标（indigo-600 背景）

### [IntentSummary.tsx](src/components/IntentSummary.tsx)

- 动画滑入式侧边栏（320px 宽度，`motion.div` 从 `x: 300 → 0`）
- 四个部分：任务进度回溯、用户偏好识别、待处理问题提示、建议后续步骤
- 各部分使用 lucide-react 图标（`History`、`Target`、`AlertCircle`）
- 待处理问题部分使用 indigo-50 背景，可点击的下一步按钮带悬停箭头动画
- 关闭按钮（X 图标）可收起侧边栏

## [src/services/ai.ts](src/services/ai.ts) API 客户端

所有函数使用 `fetch()` 以 JSON 格式调用后端端点。错误处理：
- 非正常响应：解析 JSON 错误体，回退到纯文本，抛出描述性 Error
- `checkInterruption` 和 `logEvent` 在失败时优雅地返回 `false`/`void`

## 样式模式

### CSS（Tailwind v4）

```css
/* index.css 使用 @theme 定义自定义设计令牌 */
@theme {
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, monospace;
}
```

- **基础**：白色背景，zinc-900 文字，抗锯齿渲染
- **Markdown**：消息内容的自定义 prose 样式（`p`、`ul`、`ol`、`code`、`pre`）
- **组件**：圆角 xl 卡片、微妙边框、indigo-600 强调色

### 条件类名合并

```typescript
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

在组件中用于基于角色的样式和状态相关类名。

## TypeScript 配置

- `target: "ES2022"` + `module: "ESNext"` + `moduleResolution: "bundler"`
- `jsx: "react-jsx"`（React 19 JSX 转换，无需显式 import React）
- 路径别名 `@/*` 映射到项目根目录
- `allowImportingTsExtensions: true` 允许 `.tsx` 导入
- `experimentalDecorators: true`（声明了但当前代码中未使用）
- `noEmit: true`（Vite 负责编译）

## 模式笔记

- **Ref 作为状态守卫**：使用 `useRef` 管理 `isInterruptionTriggered` 和 `isCheckingCondition`，防止跨渲染的竞态条件
- **后端懒初始化**：服务器立即开始监听；数据库、AI 客户端和 Vite 中间件通过 `initializeAll()` + `Promise.allSettled()` 异步初始化
- **动态导入**：后端对 `openai`（作为兼容层）、`pg` 和 `vite` 使用 `await import(...)` 动态导入，避免 ESM/CJS 问题并延迟加载
- **数据库写入即弃**：SQL INSERT 失败会被捕获并记录日志，但从不阻塞 API 响应
- **HMR**：可通过 `DISABLE_HMR=true` 环境变量禁用（在 AI Studio 中用于防止闪烁）
- **无路由库**：单页应用，没有 React Router — 通过 useState/useEffect 管理状态

## 依赖总结

| 包名 | 用途 |
|---------|------|
| `react` / `react-dom` | UI 框架（v19） |
| `react-markdown` | 在聊天消息中渲染 Markdown |
| `motion` | Framer Motion v12 动画库 |
| `lucide-react` | 图标库 |
| `clsx` / `tailwind-merge` | 条件 CSS 类名合并 |
| `express` | 后端 HTTP 服务器 |
| `pg` | PostgreSQL 客户端 |
| `openai` | OpenAI SDK（作为 DeepSeek 兼容层，baseURL 指向 https://api.deepseek.com） |
| `deepseek-chat` 模型 | 主模型，替代原 GPT-4 |
| `vite` / `@vitejs/plugin-react` | 构建工具 + React 插件 |
| `@tailwindcss/vite` | Tailwind CSS v4 Vite 插件 |
| `tailwindcss` | CSS 实用工具框架（v4） |
| `tsx` | 开发环境下执行 TypeScript |
| `dotenv` | 环境变量加载 |

## 修改时注意

1. 前后端在开发模式下一起运行（`npm run dev`）— 后端通过 Vite 中间件提供前端服务
2. 生产构建使用 `dist/` 中的静态文件，Express 作为静态文件回退（`app.get('*', ...)`）
3. 数据库迁移未自动化 — 首次连接时自动创建表
4. 所有 AI 调用都通过后端 API 端点进行，而非从前端直接调用
5. 后端初始化是异步且非阻塞的 — 如果 AI/DB 未就绪，API 路由返回 503
6. 项目未配置测试框架 — 没有 Jest、Vitest 或 Playwright
