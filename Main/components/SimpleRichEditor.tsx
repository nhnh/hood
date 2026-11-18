import { useState, useRef, useCallback, useEffect } from "react";
import { Bold, Italic, Underline, Strikethrough, Code, List, ListOrdered, Heading, Quote, Undo2, Redo2, AlignLeft, AlignCenter, AlignRight, SeparatorHorizontal, Eraser, Link } from "lucide-react";

interface SimpleRichEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: string;
  fillHeight?: boolean;
}

const placeholderId = "sre-placeholder-style";

export default function SimpleRichEditor({
  value,
  onChange,
  placeholder = "",
  minHeight = "100px",
  fillHeight,
}: SimpleRichEditorProps) {
  const [styleInjected, setStyleInjected] = useState(false);
  useEffect(() => {
    if (styleInjected) return;
    if (!document.getElementById(placeholderId)) {
      const style = document.createElement("style");
      style.id = placeholderId;
      style.textContent = `${placeholder ? `[data-sre-placeholder]:empty:before {
        content: attr(data-sre-placeholder);
        color: #aaa;
        pointer-events: none;
      }` : ""}
      .sre-toolbar-btn:hover { color: #111; }
      .sre-toolbar-btn:active { color: #000; }
      .sre-editor blockquote {
        border-left: 3px solid #396cd8;
        margin: 8px 0;
        padding: 8px 16px;
        background: #f0f4ff;
        color: #333;
        border-radius: 0 4px 4px 0;
      }
      .sre-editor blockquote p,
      .sre-editor blockquote div {
        margin: 4px 0;
      }
      .sre-editor pre {
        background: #f5f5f5;
        border: 1px solid #e0e0e0;
        border-radius: 4px;
        padding: 12px;
        overflow-x: auto;
        font-family: 'Consolas', 'Monaco', monospace;
        font-size: 0.85rem;
        line-height: 1.5;
        margin: 8px 0;
      }
      .sre-editor code {
        font-family: 'Consolas', 'Monaco', monospace;
        font-size: 0.9em;
      }
      .sre-editor a {
        color: #396cd8;
        text-decoration: underline;
      }`;
      document.head.appendChild(style);
    }
    setStyleInjected(true);
    return () => {
      const el = document.getElementById(placeholderId);
      if (el) el.remove();
    };
  }, [placeholder, styleInjected]);
  const editorRef = useRef<HTMLDivElement>(null);
  const isInternal = useRef(false);

  useEffect(() => {
    if (!editorRef.current || isInternal.current) return;
    if (editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value;
    }
  }, [value]);

  const exec = useCallback((cmd: string, val?: string) => {
    document.execCommand(cmd, false, val);
    if (editorRef.current) {
      isInternal.current = true;
      onChange(editorRef.current.innerHTML);
      setTimeout(() => { isInternal.current = false; }, 0);
    }
    editorRef.current?.focus();
  }, [onChange]);

  const handleInput = useCallback(() => {
    if (!editorRef.current) return;
    isInternal.current = true;
    onChange(editorRef.current.innerHTML);
    setTimeout(() => { isInternal.current = false; }, 0);
  }, [onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && ["b", "i", "u", "s"].includes(e.key.toLowerCase())) {
      e.preventDefault();
      const map: Record<string, string> = { b: "bold", i: "italic", u: "underline", s: "strikeThrough" };
      exec(map[e.key.toLowerCase()]);
    }
    if (e.key === "Enter" && !e.shiftKey) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && sel.anchorNode) {
        const node = sel.anchorNode;
        const el = node.nodeType === 3 ? node.parentElement : (node as HTMLElement);
        const listItem = el?.closest?.("li");
        if (listItem) return;
        const block = el?.closest?.("blockquote, pre");
        if (block) {
          e.preventDefault();
          document.execCommand("insertLineBreak");
        }
      }
    }
  }, [exec]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
  }, []);

  const handleLink = useCallback(() => {
    const url = prompt("Enter link URL:", "https://");
    if (url) exec("createLink", url);
  }, [exec]);

  const clearFormatting = useCallback(() => {
    const sel = window.getSelection();
    let block: Element | null = null;
    if (sel && sel.rangeCount > 0 && sel.anchorNode) {
      const node = sel.anchorNode;
      const el = node.nodeType === 3 ? node.parentElement : (node as HTMLElement);
      block = el?.closest?.("blockquote, pre") ?? null;
    }
    if (block) {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = block.innerHTML;
      block.parentNode?.replaceChild(wrapper, block);
      const range = document.createRange();
      range.selectNodeContents(wrapper);
      range.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    exec("removeFormat");
  }, [exec]);

  const sep = <span style={{ width: "1px", backgroundColor: "#e0e0e0", margin: "0 4px", flexShrink: 0, alignSelf: "stretch" }} />;

  const btnStyle: React.CSSProperties = {
    background: "none",
    border: "none",
    padding: "4px 6px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#666",
    fontSize: "0.8rem",
    boxShadow: "none",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, flex: fillHeight ? 1 : undefined, minHeight: fillHeight ? 0 : undefined }}>
      <div
        style={{
          display: "flex",
          gap: "6px",
          flexWrap: "wrap",
          padding: "8px 12px",
          borderBottom: "2px solid #eee",
          alignItems: "center",
          flexShrink: 0,
        }}>
        <button type="button" className="sre-toolbar-btn" onClick={() => exec("bold")} style={btnStyle} title="Bold (Ctrl+B)" aria-label="Bold">
          <Bold size={16} />
        </button>
        <button type="button" className="sre-toolbar-btn" onClick={() => exec("italic")} style={btnStyle} title="Italic (Ctrl+I)" aria-label="Italic">
          <Italic size={16} />
        </button>
        <button type="button" className="sre-toolbar-btn" onClick={() => exec("underline")} style={btnStyle} title="Underline (Ctrl+U)" aria-label="Underline">
          <Underline size={16} />
        </button>
        <button type="button" className="sre-toolbar-btn" onClick={() => exec("strikeThrough")} style={btnStyle} title="Strikethrough (Ctrl+S)" aria-label="Strikethrough">
          <Strikethrough size={16} />
        </button>

        {sep}

        <button type="button" className="sre-toolbar-btn" onClick={() => exec("formatBlock", "<h3>")} style={btnStyle} title="Heading" aria-label="Heading">
          <Heading size={16} />
        </button>
        <button type="button" className="sre-toolbar-btn" onClick={() => exec("formatBlock", "<p>")} style={btnStyle} title="Normal text" aria-label="Normal text">
          <span style={{ fontWeight: 600, fontSize: "12px" }}>T</span>
        </button>
        <button type="button" className="sre-toolbar-btn" onClick={() => exec("insertHTML", '<blockquote style="border-left:3px solid #396cd8;margin:8px 0;padding:8px 16px;background:#f0f4ff;color:#333;border-radius:0 4px 4px 0">Quote</blockquote>')} style={btnStyle} title="Blockquote" aria-label="Blockquote">
          <Quote size={16} />
        </button>
        <button type="button" className="sre-toolbar-btn" onClick={() => exec("insertHTML", '<pre style="background:#f5f5f5;border:1px solid #e0e0e0;border-radius:4px;padding:12px;overflow-x:auto;font-family:Consolas,Monaco,monospace;font-size:0.85rem;line-height:1.5;margin:8px 0"><code>Code here</code></pre>')} style={btnStyle} title="Code block" aria-label="Code block">
          <Code size={16} />
        </button>

        {sep}

        <button type="button" className="sre-toolbar-btn" onClick={() => exec("insertUnorderedList")} style={btnStyle} title="Bullet list" aria-label="Bullet list">
          <List size={16} />
        </button>
        <button type="button" className="sre-toolbar-btn" onClick={() => exec("insertOrderedList")} style={btnStyle} title="Numbered list" aria-label="Numbered list">
          <ListOrdered size={16} />
        </button>

        {sep}

        <button type="button" className="sre-toolbar-btn" onClick={() => exec("justifyLeft")} style={btnStyle} title="Align left" aria-label="Align left">
          <AlignLeft size={16} />
        </button>
        <button type="button" className="sre-toolbar-btn" onClick={() => exec("justifyCenter")} style={btnStyle} title="Align center" aria-label="Align center">
          <AlignCenter size={16} />
        </button>
        <button type="button" className="sre-toolbar-btn" onClick={() => exec("justifyRight")} style={btnStyle} title="Align right" aria-label="Align right">
          <AlignRight size={16} />
        </button>

        {sep}

        <button type="button" className="sre-toolbar-btn" onClick={handleLink} style={btnStyle} title="Insert link" aria-label="Insert link">
          <Link size={16} />
        </button>
        <button type="button" className="sre-toolbar-btn" onClick={() => exec("insertHorizontalRule")} style={btnStyle} title="Horizontal rule" aria-label="Horizontal rule">
          <SeparatorHorizontal size={16} />
        </button>
        <button type="button" className="sre-toolbar-btn" onClick={() => exec("superscript")} style={btnStyle} title="Superscript" aria-label="Superscript">
          <span style={{ fontWeight: 600, fontSize: "10px", lineHeight: 1 }}>A<sup>+</sup></span>
        </button>
        <button type="button" className="sre-toolbar-btn" onClick={() => exec("subscript")} style={btnStyle} title="Subscript" aria-label="Subscript">
          <span style={{ fontWeight: 600, fontSize: "10px", lineHeight: 1 }}>A<sub>-</sub></span>
        </button>

        {sep}

        <button type="button" className="sre-toolbar-btn" onClick={() => exec("undo")} style={btnStyle} title="Undo (Ctrl+Z)" aria-label="Undo">
          <Undo2 size={16} />
        </button>
        <button type="button" className="sre-toolbar-btn" onClick={() => exec("redo")} style={btnStyle} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
          <Redo2 size={16} />
        </button>
        <button type="button" className="sre-toolbar-btn" onClick={clearFormatting} style={btnStyle} title="Clear formatting" aria-label="Clear formatting">
          <Eraser size={16} />
        </button>
      </div>
      <div
        ref={editorRef}
        className="sre-editor"
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        data-sre-placeholder={placeholder}
        style={{
          width: "100%",
          minHeight: fillHeight ? 0 : minHeight,
          flex: fillHeight ? 1 : undefined,
          overflowY: "auto",
          border: "1px solid #e0e0e0",
          borderTop: "none",
          borderRadius: "0 0 4px 4px",
          padding: "12px",
          fontSize: "0.9rem",
          fontFamily: "inherit",
          boxSizing: "border-box",
          backgroundColor: "#fff",
          color: "#000",
          outline: "none",
          lineHeight: "1.6",
        }}
      />
    </div>
  );
}