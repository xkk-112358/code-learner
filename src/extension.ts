/**
 * Code Learner — VS Code extension entry point.
 *
 * Responsibilities are minimal:
 * 1. Initialize global state (cache, settings, AI service manager)
 * 2. Create and register the CodeLens and Hover providers
 * 3. Delegate all command/event/UI registrations to command modules
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { initState, setCodeLensProvider, setAIHover, getHoverTranslationStore } from './state';
import { registerAllCommands } from './commands/register';
import { CodeLearnerCodeLensProvider, setStoragePath } from './ui/codelens-provider';
import { AIHoverProvider } from './ui/hover-provider';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // 1. Initialize global singletons
  initState(context);

  // 2. Set up persistent storage path for explanations
  if (context.globalStorageUri) {
    setStoragePath(context.globalStorageUri.fsPath);
  }

  // 3. Create and register the CodeLens provider
  const codelensProvider = new CodeLearnerCodeLensProvider();
  setCodeLensProvider(codelensProvider);
  await codelensProvider.init(); // Load persisted explanations asynchronously
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codelensProvider)
  );

  // 4. Apply decorations to already-open editors
  for (const ed of vscode.window.visibleTextEditors) {
    codelensProvider.applyAllDecorations(ed);
  }

  // 5. Load persisted hover translations BEFORE registering the hover
  // provider, so restarted sessions show cached translations immediately.
  const hoverStore = getHoverTranslationStore();
  if (hoverStore && context.globalStorageUri) {
    await hoverStore.init(path.join(context.globalStorageUri.fsPath, 'hover-translations.json'));
  }

  // 6. Create and register the hover provider
  const aiHover = new AIHoverProvider(codelensProvider, hoverStore);
  setAIHover(aiHover);
  context.subscriptions.push(
    vscode.languages.registerHoverProvider({ pattern: '**' }, aiHover)
  );

  // 7. Register all commands, event handlers, and status bar
  registerAllCommands(context, codelensProvider);
}

export async function deactivate(): Promise<void> {
  // VS Code waits for the returned promise before unloading.
  // Cleanup is handled by `registerAllCommands` subscriptions,
  // but we save one final time to be safe.
  const cp = (await import('./state')).getCodeLensProvider();
  if (cp) { await cp.dispose(); }
}
