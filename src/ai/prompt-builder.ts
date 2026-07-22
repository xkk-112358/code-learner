/**
 * Prompt builder for code explanation.
 * Provides full project context for accurate, context-aware explanations.
 */

import { ExplanationRequest } from './provider';

export interface BuiltPrompts {
  systemPrompt: string;
  userPrompt: string;
}

export function buildExplanationPrompt(request: ExplanationRequest): BuiltPrompts {
  const { cell, context, explanationLanguage } = request;
  const { language, fullSource, filePath, projectFiles } = context;

  const isChinese = explanationLanguage === 'zh-CN';

  // Build project context section
  let projectSection = '';
  if (projectFiles && projectFiles.length > 0) {
    const lines: string[] = [isChinese ? '\n## 项目上下文' : '\n## Project Context'];
    for (const f of projectFiles) {
      if (f.snippet) {
        lines.push(`\n### ${f.name}\n\`\`\`\n${f.snippet.slice(0, 2500)}\n\`\`\``);
      }
    }
    projectSection = lines.join('\n');
  }

  const systemPrompt = isChinese
    ? `你是代码学习导师。用简洁的中文解释代码，必须结合整个项目上下文。

## 核心要求
1. 说明"做了什么"和"为什么这样做"，结合项目结构和其他文件来解释
2. 如果这段代码引用了其他文件的函数/类/模块，说明引用关系和用途
3. 只对关键语法或设计模式展开说明，不要逐行啰嗦
4. 控制在 3-5 句话，除非非常复杂
5. 使用 Markdown，不用标题（# ## ###），用加粗和列表
6. 不要问"你理解了吗"之类的问题
7. 如果代码有上下文依赖（如导入、API调用、继承关系），指出来自哪个文件

## 当前文件
\`\`\`${language}
${fullSource}
\`\`\`
${projectSection}`
    : `You are a code learning tutor. Explain code concisely in English with full project context.

## Requirements
1. Explain what it does AND why, referencing project structure and other files
2. If this code references functions/classes/modules from other files, explain the relationship
3. Only highlight key syntax/patterns, no line-by-line verbosity
4. Keep to 3-5 sentences unless very complex
5. Use Markdown, no headings (# ## ###), use bold and lists
6. Don't ask "do you understand" type questions
7. If there are cross-file dependencies, point out which file they come from

## Current file
\`\`\`${language}
${fullSource}
\`\`\`
${projectSection}`;

  const userPrompt = isChinese
    ? `解释以下 ${language} 代码（结合项目上下文）：
\`\`\`${language}
${cell.source}
\`\`\``
    : `Explain this ${language} code (with project context):
\`\`\`${language}
${cell.source}
\`\`\``;

  return { systemPrompt, userPrompt };
}
