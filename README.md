# Code Learner 🎓

**AI 驱动的 VS Code 代码学习助手 — 像 Jupyter 一样逐单元格学习代码**

---

## 简介

Code Learner 是一款 VS Code 扩展，让你可以像读 Jupyter 笔记本一样学习任何代码文件。它会自动将代码拆分为"单元格"（按函数、类、逻辑块），然后你可以让 AI 逐段解释 — 完美适合学习新语言、阅读开源项目、或复习自己的代码。

### 核心特性

- **📦 自动拆分为单元格** — 自动检测函数、类、导入块，也支持 `# %%` / `// %%` 手动标记
- **🤖 双 AI 提供商** — 支持 OpenAI 兼容 API（含 Azure、Ollama）和 Anthropic Claude
- **🌐 中英文讲解** — 自动跟随 VS Code 语言设置，也可手动选择
- **📐 双 UI 模式** — 侧边栏 TreeView + WebView 解释面板 + 编辑器内 CodeLens
- **📚 多语言支持** — Python、JavaScript、TypeScript、Java、C/C++、Go、Rust 等
- **⚡ 流式响应** — 实时查看 AI 解释逐字输出
- **💾 智能缓存** — LRU 缓存避免重复调用 API

## 安装

### 从 VS Code 市场安装（发布后）

1. 打开 VS Code
2. 按 `Ctrl+Shift+X` 打开扩展面板
3. 搜索 `Code Learner`
4. 点击安装

### 从源码安装

```bash
git clone <repo-url>
cd code-learner
npm install
npm run compile
```

然后在 VS Code 中按 `F5` 启动扩展开发主机。

## 快速上手

### 1. 配置 API Key

按 `Ctrl+Shift+P` 打开命令面板，运行：

```
Code Learner: Set AI API Key
```

选择提供商（OpenAI 或 Claude），然后输入你的 API Key。

### 2. 打开代码文件

打开任意 Python、JavaScript、TypeScript 等文件。

### 3. 查看单元格

- **侧边栏**：点击活动栏的 💡 图标，在"Code Cells"视图中查看所有单元格
- **CodeLens**：每个单元格上方会出现 "💡 Explain this cell" 按钮

### 4. 获取 AI 解释

点击侧边栏中的单元格或编辑器中的 CodeLens，AI 会开始流式讲解。

## 设置选项

| 设置 | 默认值 | 说明 |
|------|--------|------|
| `codeLearner.provider` | `openai` | AI 提供商：`openai` 或 `claude` |
| `codeLearner.openaiEndpoint` | `https://api.openai.com/v1` | OpenAI 兼容 API 地址 |
| `codeLearner.openaiModel` | `gpt-4o-mini` | OpenAI 模型名称 |
| `codeLearner.claudeEndpoint` | `https://api.anthropic.com` | Claude API 地址 |
| `codeLearner.claudeModel` | `claude-sonnet-4-20250514` | Claude 模型名称 |
| `codeLearner.cellSplitMode` | `both` | 单元格分割模式：`auto` / `manual` / `both` |
| `codeLearner.explanationLanguage` | `auto` | 讲解语言：`auto` / `zh-CN` / `en-US` |
| `codeLearner.showCodeLens` | `true` | 是否显示 CodeLens 按钮 |
| `codeLearner.maxTokens` | `2000` | 每次解释的最大 token 数 |
| `codeLearner.temperature` | `0.3` | AI 温度（越低越聚焦） |
| `codeLearner.cacheEnabled` | `true` | 是否启用解释缓存 |

## 单元格标记语法

你可以在代码中使用注释来手动标记单元格边界：

| 语言 | 标记语法 |
|------|---------|
| Python | `# %%`, `# ---`, `# <region>`, `# cell` |
| JavaScript/TypeScript | `// %%`, `// ---`, `// <region>` |
| Java | `// %%`, `// ---`, `/* cell */` |
| C/C++ | `// %%`, `// ---` |
| Go | `// %%`, `// ---` |
| Rust | `// %%`, `// ---` |

示例（Python）：

```python
# %%
import numpy as np
import pandas as pd

# %%
def load_data(path):
    """Load dataset from file"""
    return pd.read_csv(path)

# %%
class DataProcessor:
    def __init__(self, data):
        self.data = data
```

## 命令列表

| 命令 | 说明 |
|------|------|
| `Code Learner: Explain This Cell` | 解释当前单元格（从 CodeLens 或右键菜单） |
| `Code Learner: Set AI API Key` | 设置 AI API Key |
| `Code Learner: Refresh Cells` | 刷新单元格列表 |
| `Code Learner: Toggle CodeLens` | 开关 CodeLens 显示 |
| `Code Learner: Show Cell Explanations` | 显示解释面板 |

## 支持的编程语言

- **Python** — 完整支持（函数/类/导入检测 + 缩进感知）
- **JavaScript / TypeScript** — 完整支持（含 React JSX/TSX）
- **Java** — 完整支持（类/接口/方法检测）
- **C / C++** — 完整支持（含预处理器指令感知）
- **Go** — 完整支持（函数/结构体/接口检测）
- **Rust** — 完整支持（fn/struct/enum/trait/impl 检测）
- **其他语言** — 通用支持（手动标记 + 空白行分割）

## 隐私说明

- API Key 通过 VS Code SecretStorage 安全存储（加密）
- 代码内容仅在本地处理，发送到 AI API 时仅包含当前文件和目标单元格
- 解释缓存存储在内存中，不会持久化到磁盘

## 技术架构

```
┌──────────────────────────────────────────────────────┐
│                    VS Code Extension                  │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌────────────────────┐ │
│  │  Parser  │  │    AI    │  │        UI          │ │
│  │  Registry│  │  Service │  │  ┌──────────────┐  │ │
│  │          │  │  Manager │  │  │  TreeView    │  │ │
│  │  Python  │  │          │  │  │  (Sidebar)   │  │ │
│  │  JS/TS   │──│ OpenAI   │──│  ├──────────────┤  │ │
│  │  Java    │  │ Claude   │  │  │  WebView     │  │ │
│  │  C++     │  │          │  │  │  (Panel)     │  │ │
│  │  Go      │  │  Cache   │  │  ├──────────────┤  │ │
│  │  Rust    │  │  (LRU)   │  │  │  CodeLens    │  │ │
│  └──────────┘  └──────────┘  │  │  (Inline)    │  │ │
│                               │  └──────────────┘  │ │
└──────────────────────────────────────────────────────┘
```

## License

MIT
