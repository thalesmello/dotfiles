/** Display-only showbreak, shared by the native selection editor and Open TUI. */
const WRAPPED = Symbol.for("pi.prompt.showbreak");
interface VisualLine { startCol: number }
interface WrapEditor {
  layoutText?(width: number): { text: string; hasCursor: boolean; cursorPos?: number }[];
  buildVisualLineMap?(width: number): VisualLine[];
  handleMouse?(event: { x: number; y: number; [key: string]: unknown }): unknown;
  lastWidth?: number;
  scrollOffset?: number;
  wrapPrefixWidth?: number;
}

export function installPromptWrap(base: unknown): void {
  const editor = base as WrapEditor;
  if (Reflect.get(editor, WRAPPED) || !editor.layoutText || !editor.buildVisualLineMap) return;
  Reflect.set(editor, WRAPPED, true);
  const layout = editor.layoutText.bind(editor);
  const visual = editor.buildVisualLineMap.bind(editor);
  const mouse = editor.handleMouse?.bind(editor);
  const inset = (width: number) => width > 2 ? 2 : 0;
  editor.buildVisualLineMap = (width) => visual(Math.max(1, width - inset(width)));
  editor.layoutText = (width) => {
    const prefixWidth = inset(width);
    editor.wrapPrefixWidth = prefixWidth;
    const room = Math.max(1, width - prefixWidth);
    const rows = layout(room);
    const map = visual(room);
    return rows.map((row, index) => {
      if (!prefixWidth || !map[index] || map[index]!.startCol === 0) return row;
      return { ...row, text: "↪ " + row.text, cursorPos: row.cursorPos === undefined ? undefined : row.cursorPos + prefixWidth };
    });
  };
  if (mouse) editor.handleMouse = (event) => {
    const map = editor.buildVisualLineMap!(editor.lastWidth ?? 80);
    const row = map[(editor.scrollOffset ?? 0) + event.y - 1];
    return mouse(row && row.startCol > 0 ? { ...event, x: event.x - (editor.wrapPrefixWidth ?? 0) } : event);
  };
}
