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
- 📖 **悬停翻译** — 悬浮英文 API 文档，一键 AI 翻译；目标语言跟随 VS Code 界面语言（中文/日语/法语…）；译文按内容哈希全局缓存，换文件、重启 VS Code 后直接显示，代码/参数名/URL 绝不误翻
- ⚡ **流式响应** — AI 解释逐字实时输出
- 💡 **三种交互** — CodeLens / 悬停弹窗 / 侧边栏，支持追问互动
- 💾 **智能缓存** — LRU 缓存避免重复调用，节省费用
- 🔄 **转 Notebook** — 代码文件一键转为 `.ipynb` 格式
- 💭 **转为注释** — AI 解释一键转为代码注释，永久保存
- 🗂️ **15+ 语言** — Python、JS/TS、Java、C/C++、Go、Rust 等

### 🚀 使用流程

**1. 配置 AI 提供商**

按 `Ctrl+Shift+P` 打开命令面板，搜索 `Code Learner: Configure AI Provider`，选择 OpenAI 或 Claude 并输入 API Key。

![配置 AI 提供商](https://raw.githubusercontent.com/xkk-112358/code-learner-/main/pictures/3.png)

**2. 解释代码**

选中代码 → 右键 → **解释该代码**，AI 会流式输出解释。

![解释代码](https://raw.githubusercontent.com/xkk-112358/code-learner-/main/pictures/1.png)

**3. 查看 AI 分析**

代码末尾会出现 💡 图标，鼠标悬停即可查看 AI 的完整分析。

![AI 分析](https://raw.githubusercontent.com/xkk-112358/code-learner-/main/pictures/2.png)

**4. 以 Notebook 打开**

点击编辑器顶部的 **Open as Jupyter Notebook**，将代码一键转为 `.ipynb` 格式。

![Open as Notebook](https://raw.githubusercontent.com/xkk-112358/code-learner-/main/pictures/4.png)

**5. 浏览 Notebook**

转换后的 Notebook 保留了原始代码结构，可按单元格浏览。

![Notebook 结果](https://raw.githubusercontent.com/xkk-112358/code-learner-/main/pictures/5.png)

**6. 翻译悬停文档**

悬浮英文 API 符号（如 Python 的 docstring），点击悬浮窗中的翻译按钮，AI 立即将英文文档翻译为你的界面语言（中文界面译成中文、日语界面译成日语，依此类推）；译文支持「🔙 隐藏翻译」「🔄 重新翻译」，并全局缓存——任何文件、任何位置、重启 VS Code 后都直接显示相同译文。

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
| `codeLearner.claudeModel` | `claude-sonnet-5` | Claude 模型 |
| `codeLearner.maxTokens` | `5000` | 每次最大 token 数 |
| `codeLearner.temperature` | `0.3` | AI 温度 |
| `codeLearner.cacheEnabled` | `true` | 启用缓存 |

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
- 📖 **Hover translation** — one-click AI translation of English API docs in the hover; the target language follows your VS Code UI language (Chinese, Japanese, French, ...); translations are globally cached by content hash (any file, any position, after restart) and code/parameter names/URLs are never mistranslated
- ⚡ **Streaming** — Real-time AI output character by character
- 💡 **3 UI modes** — CodeLens / Hover popup / Sidebar, with follow-up Q&A
- 💾 **Smart cache** — LRU cache saves API calls and costs
- 🔄 **Export to Notebook** — One-click code-to-`.ipynb` conversion
- 💭 **To Comments** — Convert AI explanations into code comments
- 🗂️ **15+ languages** — Python, JS/TS, Java, C/C++, Go, Rust, and more

### 🚀 Usage

**1. Configure AI Provider**

Press `Ctrl+Shift+P`, search for `Code Learner: Configure AI Provider`, choose OpenAI or Claude and enter your API key.

![Configure AI Provider](https://raw.githubusercontent.com/xkk-112358/code-learner-/main/pictures/3.png)

**2. Explain Code**

Select code → Right-click → **Explain This Code**. AI explanation will stream in real-time.

![Explain Code](https://raw.githubusercontent.com/xkk-112358/code-learner-/main/pictures/1.png)

**3. View AI Analysis**

A 💡 icon appears at the end of the code. Hover over it to see the full AI analysis.

![AI Analysis](https://raw.githubusercontent.com/xkk-112358/code-learner-/main/pictures/2.png)

**4. Open as Notebook**

Click **Open as Jupyter Notebook** at the top of the editor to convert your code file into `.ipynb` format.

![Open as Notebook](https://raw.githubusercontent.com/xkk-112358/code-learner-/main/pictures/4.png)

**5. Browse the Notebook**

The converted notebook preserves the original code structure for cell-by-cell browsing.

![Notebook Result](https://raw.githubusercontent.com/xkk-112358/code-learner-/main/pictures/5.png)

**6. Translate Hover Docs**

Hover over an English API symbol (e.g. a Python docstring) and click the translate button — the AI translates the documentation into your UI language instantly (Chinese UI → Chinese, Japanese UI → Japanese, and so on). The translation supports "Hide Translation" / "Re-translate" and is cached globally: any file, any position, even after restarting VS Code shows the same translation.

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
| `codeLearner.claudeModel` | `claude-sonnet-5` | Claude model |
| `codeLearner.maxTokens` | `5000` | Max tokens per explanation |
| `codeLearner.temperature` | `0.3` | AI temperature |
| `codeLearner.cacheEnabled` | `true` | Enable cache |

### 🔒 Privacy

- API keys encrypted via VS Code SecretStorage
- Only current file and target cell sent to AI API
- Explanation cache is in-memory only, never persisted to disk

---

<div align="center">

**MIT License** · VS Code ^1.85.0 · v0.6.0

 Made By: xkk-112358

</div>
