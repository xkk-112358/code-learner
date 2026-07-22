<div align="center">

# Code Learner 🎓

**像读 Jupyter 一样学代码 · Learn code like reading a notebook**

[🏠 中文](#-中文) · [🌍 English](#-english)

</div>

---

## 🏠 中文

<p align="center">
  <b>VS Code 扩展</b> — 自动拆分代码为逻辑单元格，AI 逐块流式讲解
</p>

### ✨ 特性

- 📦 **自动分块** — 按函数、类、导入块自动分割，也支持 `# %%` / `// %%` 手动标记
- 🤖 **双 AI 提供商** — OpenAI 兼容 API（含 Azure、Ollama）+ Anthropic Claude
- 🌐 **中英讲解** — 跟随 VS Code 语言设置自动切换
- ⚡ **流式响应** — AI 解释逐字实时输出
- 💡 **三种交互** — CodeLens / 悬停弹窗 / 侧边栏，支持追问互动
- 💾 **智能缓存** — LRU 缓存避免重复调用，节省费用
- 🔄 **转 Notebook** — 代码文件一键转为 `.ipynb` 格式
- 💭 **转为注释** — AI 解释一键转为代码注释，永久保存
- 🗂️ **15+ 语言** — Python、JS/TS、Java、C/C++、Go、Rust 等

### 🚀 快速开始

#### 1. 安装

```bash
git clone https://github.com/xkk-112358/code-learner.git
cd code-learner
npm install
npm run compile
```

然后在 VS Code 中按 `F5` 启动扩展开发主机。

#### 2. 配置 API Key

按 `Ctrl+Shift+P` 打开命令面板，运行：

```
Code Learner: Configure AI Provider
```

选择 OpenAI 或 Claude，输入 API Key。

#### 3. 使用

- 打开任意代码文件
- 点击编辑器顶部的 **Open as Jupyter Notebook**，或悬停在 💡 图标上查看 AI 解释
- 选中代码 → 右键 → **解释该代码**

### 📋 命令

| 命令 | 功能 |
|------|------|
| `Code Learner: Configure AI Provider` | 配置 AI 提供商 |
| `Code Learner: Explain Selected` | 解释选中的代码 |
| `Code Learner: Convert All to Comments` | 将所有 AI 解释转为注释 |
| `Code Learner: Open as Notebook` | 以 Jupyter Notebook 打开 |

### ⚙️ 设置

| 设置 | 默认值 | 说明 |
|------|--------|------|
| `codeLearner.provider` | `openai` | AI 提供商 |
| `codeLearner.openaiModel` | `gpt-4o-mini` | OpenAI 模型 |
| `codeLearner.claudeModel` | `claude-sonnet-4-20250514` | Claude 模型 |
| `codeLearner.maxTokens` | `2000` | 每次最大 token 数 |
| `codeLearner.temperature` | `0.3` | AI 温度 |
| `codeLearner.cacheEnabled` | `true` | 启用缓存 |

### 📁 项目结构

```
src/
├── parser/          # 代码解析器（自动分块）
│   ├── cell.ts      # 数据模型
│   ├── base-parser.ts
│   ├── auto-splitter.ts
│   └── python-parser.ts, js-ts-parser.ts ...
├── ai/              # AI 服务层
│   ├── openai-provider.ts
│   ├── claude-provider.ts
│   ├── ai-service-manager.ts
│   ├── cache.ts
│   └── nb-generator.ts
├── ui/              # 用户界面
│   ├── codelens-provider.ts
│   ├── hover-provider.ts
│   └── sidebar/
└── utils/           # 工具函数
```

### 🔒 隐私

- API Key 通过 VS Code SecretStorage 加密存储
- 仅发送当前文件和目标单元格到 AI API
- 解释缓存仅在内存中，不持久化到磁盘

---

## 🌍 English

<p align="center">
  <b>VS Code Extension</b> — Auto-split code into logical cells, AI explains each with streaming
</p>

### ✨ Features

- 📦 **Auto-split** — Detect functions, classes, imports; also supports `# %%` / `// %%` manual markers
- 🤖 **Dual AI** — OpenAI-compatible APIs (Azure, Ollama) + Anthropic Claude
- 🌐 **Bilingual** — Auto-switch between Chinese and English
- ⚡ **Streaming** — Real-time AI output character by character
- 💡 **3 UI modes** — CodeLens / Hover popup / Sidebar, with follow-up Q&A
- 💾 **Smart cache** — LRU cache saves API calls and costs
- 🔄 **Export to Notebook** — One-click code-to-`.ipynb` conversion
- 💭 **To Comments** — Convert AI explanations into code comments
- 🗂️ **15+ languages** — Python, JS/TS, Java, C/C++, Go, Rust, and more

### 🚀 Quick Start

#### 1. Install

```bash
git clone https://github.com/xkk-112358/code-learner.git
cd code-learner
npm install
npm run compile
```

Press `F5` in VS Code to launch the Extension Development Host.

#### 2. Configure API Key

Open Command Palette (`Ctrl+Shift+P`) and run:

```
Code Learner: Configure AI Provider
```

Choose OpenAI or Claude, then enter your API key.

#### 3. Usage

- Open any code file
- Click **Open as Jupyter Notebook** at the top, or hover over 💡 icons for AI explanations
- Select code → Right-click → **Explain Selected**

### 📋 Commands

| Command | Description |
|---------|-------------|
| `Code Learner: Configure AI Provider` | Set up AI provider |
| `Code Learner: Explain Selected` | Explain selected code |
| `Code Learner: Convert All to Comments` | Convert all explanations to comments |
| `Code Learner: Open as Notebook` | Open as Jupyter Notebook |

### ⚙️ Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `codeLearner.provider` | `openai` | AI provider |
| `codeLearner.openaiModel` | `gpt-4o-mini` | OpenAI model |
| `codeLearner.claudeModel` | `claude-sonnet-4-20250514` | Claude model |
| `codeLearner.maxTokens` | `2000` | Max tokens per explanation |
| `codeLearner.temperature` | `0.3` | AI temperature |
| `codeLearner.cacheEnabled` | `true` | Enable cache |

### 📁 Project Structure

```
src/
├── parser/          # Code parsers (cell splitting)
│   ├── cell.ts      # Data model
│   ├── base-parser.ts
│   ├── auto-splitter.ts
│   └── python-parser.ts, js-ts-parser.ts ...
├── ai/              # AI service layer
│   ├── openai-provider.ts
│   ├── claude-provider.ts
│   ├── ai-service-manager.ts
│   ├── cache.ts
│   └── nb-generator.ts
├── ui/              # User interface
│   ├── codelens-provider.ts
│   ├── hover-provider.ts
│   └── sidebar/
└── utils/           # Utilities
```

### 🔒 Privacy

- API keys encrypted via VS Code SecretStorage
- Only current file and target cell sent to AI API
- Explanation cache is in-memory only, never persisted to disk

---

<div align="center">

**MIT License** · VS Code ^1.85.0 · v0.2.0

 Made with ❤️

</div>
