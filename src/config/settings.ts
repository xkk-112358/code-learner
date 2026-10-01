/**
 * Settings module for Code Learner extension.
 */

import * as vscode from 'vscode';
import { nodeRequestAndRead } from '../ai/streaming';
import { t } from '../utils/helpers';

export type AIProviderType = 'openai' | 'claude';

/**
 * How the 💡 AI explanation is attached to the code:
 *  - `inlay-hint` (default): the 💡 is an InlayHint whose tooltip shows ONLY
 *    the AI explanation — the tooltip is rendered outside the hover-merge
 *    system, so the language server's hover is NOT mixed in.
 *  - `decoration`: the classic line-end 💡 decoration; hovering it goes
 *    through the editor's hover providers, so the language server's hover
 *    (e.g. Pylance) gets merged into the same popup.
 */
export type HoverCarrier = 'inlay-hint' | 'decoration';

export interface CodeLearnerConfig {
  provider: AIProviderType;
  openaiEndpoint: string;
  openaiModel: string;
  claudeEndpoint: string;
  claudeModel: string;
  maxTokens: number;
  temperature: number;
  cacheEnabled: boolean;
  hoverCarrier: HoverCarrier;
}

export class CodeLearnerSettings {
  private static readonly CONFIG_SECTION = 'codeLearner';

  constructor(private secrets: vscode.SecretStorage) {}

  getConfig(): CodeLearnerConfig {
    const config = vscode.workspace.getConfiguration(CodeLearnerSettings.CONFIG_SECTION);
    return {
      provider: config.get<AIProviderType>('provider', 'openai'),
      openaiEndpoint: config.get<string>('openaiEndpoint', 'https://api.openai.com/v1'),
      openaiModel: config.get<string>('openaiModel', 'gpt-4o-mini'),
      claudeEndpoint: config.get<string>('claudeEndpoint', 'https://api.anthropic.com'),
      claudeModel: config.get<string>('claudeModel', 'claude-sonnet-5'),
      maxTokens: config.get<number>('maxTokens', 2000),
      temperature: config.get<number>('temperature', 0.3),
      cacheEnabled: config.get<boolean>('cacheEnabled', true),
      hoverCarrier: config.get<HoverCarrier>('hoverCarrier', 'inlay-hint'),
    };
  }

  async getApiKey(provider: AIProviderType): Promise<string | undefined> {
    return this.secrets.get(`codeLearner.${provider}ApiKey`);
  }

  async setApiKey(provider: AIProviderType, key: string): Promise<void> {
    await this.secrets.store(`codeLearner.${provider}ApiKey`, key);
  }

  async runSetupWizard(): Promise<void> {
    const provider = await vscode.window.showQuickPick(
      [
        { label: 'OpenAI', description: 'OpenAI / Azure / Ollama / any compatible API', target: 'openai' as AIProviderType },
        { label: 'Claude', description: 'Anthropic Claude', target: 'claude' as AIProviderType },
      ],
      { placeHolder: 'Choose AI provider', ignoreFocusOut: true }
    );
    if (!provider) return;

    const key = await vscode.window.showInputBox({
      prompt: `Enter your ${provider.target === 'openai' ? 'OpenAI' : 'Claude'} API key`,
      password: true,
      ignoreFocusOut: true,
      placeHolder: provider.target === 'openai' ? 'sk-...' : 'sk-ant-...',
    });
    if (!key) return;

    const defaultEndpoint = provider.target === 'openai'
      ? 'https://api.openai.com/v1'
      : 'https://api.anthropic.com';
    const endpoint = await vscode.window.showInputBox({
      prompt: 'API endpoint URL (Enter for default)',
      value: defaultEndpoint,
      ignoreFocusOut: true,
    });

    const defaultModel = provider.target === 'openai' ? 'gpt-4o-mini' : 'claude-sonnet-5';
    const model = await vscode.window.showInputBox({
      prompt: 'Model name (Enter for default: ' + defaultModel + ')',
      value: defaultModel,
      ignoreFocusOut: true,
    });

    // Apply everything only after all input was collected, so cancelling the
    // wizard partway never leaves a half-configured extension.
    const config = vscode.workspace.getConfiguration('codeLearner');
    await config.update('provider', provider.target, vscode.ConfigurationTarget.Global);
    await this.setApiKey(provider.target, key);
    if (endpoint) {
      const keyName = provider.target === 'openai' ? 'openaiEndpoint' : 'claudeEndpoint';
      await config.update(keyName, endpoint, vscode.ConfigurationTarget.Global);
    }
    if (model) {
      const keyName = provider.target === 'openai' ? 'openaiModel' : 'claudeModel';
      await config.update(keyName, model, vscode.ConfigurationTarget.Global);
    }

    // 6. Connectivity test: cheap non-streaming request with max_tokens=1
    const testEndpoint = endpoint || defaultEndpoint;
    const testModel = model || defaultModel;
    const errMsg = await testConnection(provider.target, key, testEndpoint, testModel);
    if (errMsg === null) {
      vscode.window.showInformationMessage(t(provider.label + ' 配置成功，连接正常！', provider.label + ' configured and connected!'));
    } else {
      vscode.window.showWarningMessage(t(provider.label + ' 配置成功，但连接测试失败：', provider.label + ' configured, but connection test failed: ') + errMsg);
    }
  }
}

/** Test AI provider connectivity with a minimal request. Returns null on success, error message on failure. */
async function testConnection(
  provider: AIProviderType,
  apiKey: string,
  endpoint: string,
  model: string
): Promise<string | null> {
  const suffix = provider === 'openai' ? '/chat/completions' : '/v1/messages';
  const url = endpoint.replace(/\/$/, '') + suffix;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (provider === 'openai') {
    headers['Authorization'] = 'Bearer ' + apiKey;
  } else {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  }
  const body = JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] });
  try {
    const res = await nodeRequestAndRead(url, {
      method: 'POST', headers, body,
      signal: AbortSignal.timeout(15_000),
    });
    if (res.statusCode >= 200 && res.statusCode < 300) return null;
    try { return JSON.parse(res.body).error?.message || 'HTTP ' + res.statusCode; }
    catch { return res.body || 'HTTP ' + res.statusCode; }
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
