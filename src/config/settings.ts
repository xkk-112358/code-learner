/**
 * Settings module for Code Learner extension.
 */

import * as vscode from 'vscode';

export type AIProviderType = 'openai' | 'claude';

export interface CodeLearnerConfig {
  provider: AIProviderType;
  openaiEndpoint: string;
  openaiModel: string;
  claudeEndpoint: string;
  claudeModel: string;
  maxTokens: number;
  temperature: number;
  cacheEnabled: boolean;
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
      claudeModel: config.get<string>('claudeModel', 'claude-sonnet-4-20250514'),
      maxTokens: config.get<number>('maxTokens', 2000),
      temperature: config.get<number>('temperature', 0.3),
      cacheEnabled: config.get<boolean>('cacheEnabled', true),
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

    const config = vscode.workspace.getConfiguration('codeLearner');
    await config.update('provider', provider.target, vscode.ConfigurationTarget.Global);

    const key = await vscode.window.showInputBox({
      prompt: `Enter your ${provider.target === 'openai' ? 'OpenAI' : 'Claude'} API key`,
      password: true,
      ignoreFocusOut: true,
      placeHolder: provider.target === 'openai' ? 'sk-...' : 'sk-ant-...',
    });
    if (!key) return;
    await this.setApiKey(provider.target, key);

    const defaultEndpoint = provider.target === 'openai'
      ? 'https://api.openai.com/v1'
      : 'https://api.anthropic.com';
    const endpoint = await vscode.window.showInputBox({
      prompt: 'API endpoint URL (Enter for default)',
      value: defaultEndpoint,
      ignoreFocusOut: true,
    });
    if (endpoint) {
      const keyName = provider.target === 'openai' ? 'openaiEndpoint' : 'claudeEndpoint';
      await config.update(keyName, endpoint, vscode.ConfigurationTarget.Global);
    }

    const defaultModel = provider.target === 'openai' ? 'gpt-4o-mini' : 'claude-sonnet-4-20250514';
    const model = await vscode.window.showInputBox({
      prompt: 'Model name (Enter for default: ' + defaultModel + ')',
      value: defaultModel,
      ignoreFocusOut: true,
    });
    if (model) {
      const keyName = provider.target === 'openai' ? 'openaiModel' : 'claudeModel';
      await config.update(keyName, model, vscode.ConfigurationTarget.Global);
    }

    vscode.window.showInformationMessage('Code Learner: ' + provider.label + ' configured!');
  }
}
