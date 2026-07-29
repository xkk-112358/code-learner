/**
 * Explanation panel - WebView panel for displaying AI explanations.
 * Uses inline script to avoid CSP loading issues.
 */

import * as vscode from 'vscode';
import { CodeCell } from '../../parser/cell';

export class ExplanationPanel {
  public static currentPanel: ExplanationPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  public readonly _disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel) {
    this._panel = panel;
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  static createOrShow(extensionUri: vscode.Uri): ExplanationPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (ExplanationPanel.currentPanel) {
      ExplanationPanel.currentPanel._panel.reveal(column);
      return ExplanationPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'codeLearner.explanation',
      'Code Learner',
      column || vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    ExplanationPanel.currentPanel = new ExplanationPanel(panel);
    return ExplanationPanel.currentPanel;
  }

  showExplanation(cell: CodeCell, language: string): void {
    this._panel.title = 'Code Learner - Cell ' + (cell.index + 1);
    this._panel.webview.html = this.getHtml(cell, language);
  }

  updateStream(chunk: string): void {
    this._panel.webview.postMessage({ type: 'stream-chunk', text: chunk });
  }

  streamComplete(elapsed?: number, chars?: number): void {
    const msg: Record<string, unknown> = { type: 'stream-end' };
    if (elapsed !== undefined) { msg.elapsed = elapsed; msg.chars = chars; }
    this._panel.webview.postMessage(msg);
  }

  streamError(message: string): void {
    this._panel.webview.postMessage({ type: 'stream-error', message });
  }

  showLoading(): void {
    this._panel.webview.postMessage({ type: 'stream-start' });
  }

  onDidReceiveMessage(listener: (message: unknown) => void): vscode.Disposable {
    return this._panel.webview.onDidReceiveMessage(listener);
  }

  private getHtml(cell: CodeCell, language: string): string {
    const src = cell.source
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const dark = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark;
    const bg = dark ? '#1e1e1e' : '#fff';
    const fg = dark ? '#d4d4d4' : '#333';
    const cb = dark ? '#2d2d2d' : '#f5f5f5';
    const bd = dark ? '#404040' : '#e0e0e0';
    const ac = '#007acc';

    const ci = cell.index + 1;
    const ct = cell.type;

    // Build HTML by concatenating strings to avoid template backtick issues
    let html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width,initial-scale=1.0">';
    html += '<title>Code Learner</title><style>';
    html += '*{margin:0;padding:0;box-sizing:border-box}';
    html += 'body{font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;';
    html += 'background:' + bg + ';color:' + fg + ';padding:16px;line-height:1.6}';
    html += '.hdr{display:flex;align-items:center;gap:8px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid ' + bd + '}';
    html += '.tag{background:' + ac + ';color:#fff;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:600}';
    html += '.typ{color:' + ac + ';font-size:13px}';
    html += '.src{background:' + cb + ';border:1px solid ' + bd + ';border-radius:6px;padding:12px;margin-bottom:16px;';
    html += 'overflow-x:auto;font-family:\'Fira Code\',Consolas,monospace;font-size:13px;line-height:1.5;white-space:pre-wrap}';
    html += '#out{min-height:60px}';
    html += '#out h1,#out h2,#out h3{margin:12px 0 6px}';
    html += '#out p{margin:6px 0}';
    html += '#out code{background:' + cb + ';padding:1px 4px;border-radius:3px;font-family:Consolas,monospace;font-size:13px}';
    html += '#out pre{background:' + cb + ';border:1px solid ' + bd + ';border-radius:4px;padding:8px 12px;overflow-x:auto;margin:8px 0}';
    html += '#out ul,#out ol{margin:6px 0;padding-left:24px}';
    html += '#out li{margin:2px 0}';
    html += '.cur::after{content:\'|\';animation:blink 1s step-end infinite;color:' + ac + '}';
    html += '@keyframes blink{50%{opacity:0}}';
    html += '.loading{display:flex;align-items:center;gap:8px;color:#888;font-style:italic}';
    html += '.spin{width:16px;height:16px;border:2px solid ' + bd + ';border-top-color:' + ac + ';border-radius:50%;animation:spin .8s linear infinite}';
    html += '@keyframes spin{to{transform:rotate(360deg)}}';
    html += '.err{color:#c33;background:#fef0f0;border:1px solid #c33;border-radius:6px;padding:12px;margin:8px 0;white-space:pre-wrap}';
    html += '.act{display:flex;gap:8px;margin-top:16px;flex-wrap:wrap}';
    html += '.act button{background:' + ac + ';color:#fff;border:none;padding:6px 14px;border-radius:4px;cursor:pointer;font-size:13px}';
    html += '.act button:hover{opacity:.9}';
    html += '.act button.sc{background:transparent;color:' + ac + ';border:1px solid ' + ac + '}';
    html += '</style></head><body>';

    html += '<div class="hdr"><span class="tag">Cell ' + ci + '</span><span class="typ">' + ct + '</span></div>';
    html += '<div class="src">' + src + '</div>';
    html += '<div id="st" class="loading"><div class="spin"></div><span>AI is thinking...</span></div>';
    html += '<div id="out"></div>';
    html += '<div class="act"><button id="re" class="sc">Re-explain</button><button id="cp" class="sc">Copy</button></div>';

    // Inline JS - avoid backticks by using \x60 escape
    html += '<script>';
    html += '(function(){';
    html += 'var api=acquireVsCodeApi();';
    html += 'var out=document.getElementById(\'out\');';
    html += 'var st=document.getElementById(\'st\');';
    html += 'var txt=\'\',done=false;';

    // esc function
    html += 'function esc(s){return s.replace(/&/g,\'&amp\').replace(/</g,\'&lt\').replace(/>/g,\'&gt\')}';

    // render markdown function
    html += 'function render(t){';
    html += 'var h=\'\',lines=t.split(\'\\n\'),inC=false,buf=\'\',i,l;';
    html += 'for(i=0;i<lines.length;i++){';
    html += 'l=lines[i];';
    html += 'if(l.indexOf(\'\\x60\\x60\\x60\')===0){';
    html += 'if(inC){h+=\'<pre><code>\'+esc(buf)+\'</code></pre>\';buf=\'\';inC=false}else{inC=true}';
    html += 'continue}';
    html += 'if(inC){buf+=l+\'\\n\';continue}';
    html += 'if(l.indexOf(\'### \')===0){h+=\'<h3>\'+l.slice(4)+\'</h3>\'}';
    html += 'else if(l.indexOf(\'## \')===0){h+=\'<h2>\'+l.slice(3)+\'</h2>\'}';
    html += 'else if(l.indexOf(\'# \')===0&&l.indexOf(\'#include\')<0&&l.indexOf(\'#define\')<0){h+=\'<h1>\'+l.slice(2)+\'</h1>\'}';
    html += 'else if(l.indexOf(\'- \')===0){h+=\'<li>\'+l.slice(2)+\'</li>\'}';
    html += 'else if(/^\\d+\\.\\s/.test(l)){h+=\'<li>\'+l.replace(/^\\d+\\.\\s/,\'\')+\'</li>\'}';
    html += 'else if(l.trim()===\'\'){h+=\'<p></p>\'}';
    html += 'else{';
    html += 'var m=l.replace(/\\*\\*(.+?)\\*\\*/g,\'<strong>$1</strong>\').replace(/\\*(.+?)\\*/g,\'<em>$1</em>\').replace(/\\x60([^\\x60]+)\\x60/g,\'<code>$1</code>\');';
    html += 'h+=\'<p>\'+m+\'</p>\'}';
    html += '}';
    html += 'if(inC){h+=\'<pre><code>\'+esc(buf)+\'</code></pre>\'}';
    html += 'return \'<div>\'+h+\'</div>\'}';

    // update display
    // eslint-disable-next-line no-useless-escape
    html += 'function upd(){out.innerHTML=render(txt)+(done?\'\':\'<span class=\\"cur\\"></span>\')}';

    // message handler
    html += 'window.addEventListener(\'message\',function(e){';
    html += 'var m=e.data;';
    html += 'switch(m.type){';
    html += 'case\'stream-start\':txt=\'\';done=false;st.style.display=\'flex\';out.innerHTML=\'\';break;';
    html += 'case\'stream-chunk\':st.style.display=\'none\';txt+=m.text;upd();break;';
    html += 'case\'stream-end\':done=true;st.style.display=\'none\';if(m.elapsed){var sec=(m.elapsed/1000).toFixed(1);var tokens=Math.round((m.chars||0)/4);header="⏱ "+sec+"s · "+tokens+"tok";}upd();break;';

'}upd();break;';
    // eslint-disable-next-line no-useless-escape
    html += 'case\'stream-error\':st.style.display=\'none\';out.innerHTML=\'<div class=\\\"err\\\">\'+esc(m.message)+\'</div>\';break;';
    html += '}';
    html += '});';

    // re-explain button
    html += 'document.getElementById(\'re\').addEventListener(\'click\',function(){api.postMessage({type:\'re-explain\',cellIndex:' + ci + '})});';
    html += 'document.getElementById(\'cp\').addEventListener(\'click\',function(){';
    html += 'if(txt){navigator.clipboard.writeText(txt).then(function(){var b=document.getElementById(\'cp\');b.textContent=\'Copied!\';setTimeout(function(){b.textContent=\'Copy\'},2000)})}';
    html += '});';

    html += '})();';
    html += '</script>';
    html += '</body></html>';

    return html;
  }

  dispose(): void {
    ExplanationPanel.currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) { d.dispose(); }
    this._disposables.length = 0;
  }
}
