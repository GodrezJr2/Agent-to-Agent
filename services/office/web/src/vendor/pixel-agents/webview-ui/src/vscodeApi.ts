// A2A Office shim: the pixel-agents webview talks to a VS Code extension host
// through vscode.postMessage. Here the host is the office app itself, so
// messages go to in-page listeners (see onHostMessage) instead.
type HostListener = (msg: any) => void;
const listeners = new Set<HostListener>();

export const vscode: { postMessage(msg: unknown): void } = {
  postMessage(msg: unknown) {
    for (const listener of listeners) listener(msg);
  },
};

export function onHostMessage(listener: HostListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
