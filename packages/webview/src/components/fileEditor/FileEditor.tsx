import React, { useEffect, useRef, useState } from "react";
import { loadEditorLib, type CodeEditorHandle } from "./editorLoader";
import { isDarkTheme } from "../../utils/theme";

export interface FileEditorProps {
  /** Path of the file being edited — used for the syntax mode and as the mount
   *  key: switching files remounts the editor. */
  path: string;
  /** Text the editor starts with (the draft's current value, or the file's). */
  initialValue: string;
  onChange: (value: string) => void;
  onSave: () => void;
}

/**
 * Mounts the lazily loaded CodeMirror editor for the file panel's edit mode.
 * Uncontrolled on purpose: the editor owns the text, the parent only receives
 * changes, so React re-renders never reset the cursor or the undo history.
 */
export const FileEditor: React.FC<FileEditorProps> = ({
  path,
  initialValue,
  onChange,
  onSave,
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<CodeEditorHandle | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(
    "loading",
  );
  // Latest callbacks, so a re-render never forces a remount.
  const handlersRef = useRef({ onChange, onSave });
  handlersRef.current = { onChange, onSave };
  // `initialValue` is the mount-time document, never a dependency: remounting on
  // every keystroke would reset the cursor, so the panel rekeys this component
  // on the path instead. Kept in a ref so the effect below reads it without
  // listing it as a dependency.
  const initialValueRef = useRef(initialValue);

  useEffect(() => {
    let disposed = false;
    setStatus("loading");
    loadEditorLib()
      .then((lib) => {
        if (disposed || !hostRef.current) return;
        handleRef.current = lib.createCodeEditor(hostRef.current, {
          doc: initialValueRef.current,
          path,
          dark: isDarkTheme(),
          onChange: (value) => handlersRef.current.onChange(value),
          onSave: () => handlersRef.current.onSave(),
        });
        setStatus("ready");
        handleRef.current.focus();
      })
      .catch(() => {
        if (!disposed) setStatus("failed");
      });
    return () => {
      disposed = true;
      handleRef.current?.destroy();
      handleRef.current = null;
    };
  }, [path]);

  return (
    <div className="file-pane-editor">
      {status === "loading" && (
        <div className="file-pane-status" data-testid="file-editor-loading">
          <i className="codicon codicon-loading codicon-modifier-spin" />
          <span>正在加载编辑器…</span>
        </div>
      )}
      {status === "failed" && (
        <div className="file-pane-status" data-testid="file-editor-failed">
          <i className="codicon codicon-error file-pane-status-icon" />
          <span>编辑器加载失败，请重试或改用外部编辑器</span>
        </div>
      )}
      <div ref={hostRef} className="file-pane-editor-host" />
    </div>
  );
};

export default FileEditor;
