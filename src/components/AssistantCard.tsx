import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { useI18n } from "../i18n/context";
import { MAX_PROJECT_MEMORY_CHARS } from "../lib/projectMemory";
import { splitTextDiff } from "../lib/diffPreview";
import type { ChatMessage } from "../types/chat";

type AssistantCardProps = {
  height: number;
  onHeightChange: (height: number) => void;
  onCollapse: () => void;
  chat: ChatMessage[];
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  quickPrompts: string[];
  onKeep: (message: ChatMessage) => void;
  onUndo: (message: ChatMessage) => void;
  sending?: boolean;
  memoryNotes?: string;
  onMemoryNotesChange?: (notes: string) => void;
};

function IconSend() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2.5 8h11M9 3.5 13.5 8 9 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconStop() {
  return <span className="stop-icon" aria-hidden />;
}

export function AssistantCard(props: AssistantCardProps) {
  const { t } = useI18n();
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memoryDraft, setMemoryDraft] = useState(props.memoryNotes ?? "");

  useEffect(() => {
    setMemoryDraft(props.memoryNotes ?? "");
  }, [props.memoryNotes]);

  useLayoutEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [props.chat]);

  function flushMemory(next: string = memoryDraft) {
    props.onMemoryNotesChange?.(next);
  }

  function onResizeStart(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    dragRef.current = { startY: event.clientY, startH: props.height };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
  }
  function onResizeMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    props.onHeightChange(Math.min(560, Math.max(180, dragRef.current.startH + dragRef.current.startY - event.clientY)));
  }
  function onResizeEnd() {
    dragRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }

  const hasMemory = Boolean((props.memoryNotes ?? "").trim());

  return (
    <div className="ai-float" role="dialog" aria-label={t("assistant.title")}>
      <div className="ai-card" style={{ height: props.height }}>
        <div className="ai-resize" onPointerDown={onResizeStart} onPointerMove={onResizeMove} onPointerUp={onResizeEnd} onPointerCancel={onResizeEnd} role="separator" aria-orientation="horizontal" aria-label={t("assistant.resize")} title={t("assistant.resize")}>
          <span className="ai-grip" />
        </div>
        <div className="ai-card-bar">
          <span className="ai-card-title">{t("assistant.title")}</span>
          <div className="panel-head-actions">
            {props.onMemoryNotesChange && (
              <button
                className="icon-btn"
                type="button"
                title={t("assistant.memory")}
                aria-label={t("assistant.memory")}
                aria-pressed={memoryOpen}
                data-active={hasMemory ? "1" : undefined}
                onClick={() => {
                  if (memoryOpen) flushMemory();
                  setMemoryOpen((open) => !open);
                }}
              >
                ✎
              </button>
            )}
            <button className="icon-btn" type="button" title={t("assistant.collapse")} onClick={props.onCollapse}>⌄</button>
          </div>
        </div>
        <div className="ai-body">
          {memoryOpen && props.onMemoryNotesChange && (
            <div className="ai-memory">
              <div className="ai-memory-head">
                <span>{t("assistant.memory")}</span>
                <span className="ai-memory-count">
                  {memoryDraft.length}/{MAX_PROJECT_MEMORY_CHARS}
                </span>
              </div>
              <p className="ai-memory-hint">{t("assistant.memoryHint")}</p>
              <textarea
                className="ai-memory-input"
                value={memoryDraft}
                maxLength={MAX_PROJECT_MEMORY_CHARS}
                rows={4}
                placeholder={t("assistant.memoryPlaceholder")}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
                  setMemoryDraft(event.currentTarget.value);
                }}
                onBlur={() => flushMemory()}
              />
            </div>
          )}
          <div className="ai-thread" ref={threadRef}>
            {props.chat.map((message) => {
              const suggestion = message.suggestion;
              const status = suggestion?.status ?? "pending";
              const kept = status === "applied";
              const dismissed = status === "dismissed";
              const canKeep = (status === "pending" || status === "undone") && Boolean(suggestion?.patchSet) && !suggestion?.patchError && !suggestion?.legacyDisplayOnly;
              const canSecondary = status === "applied" || status === "pending" || status === "undone";
              return (
                <div key={message.id} className={`msg ${message.role}`}>
                  <div className="msg-role">{message.role === "assistant" ? "MedPrism" : t("assistant.you")}</div>
                  <div className="msg-bubble">{message.content}</div>
                  {suggestion && !dismissed && (
                    <div className={`suggestion ${kept ? "is-kept" : ""}`}>
                      <div className="suggestion-head">{suggestion.title}</div>
                      {suggestion.patchError && <div className="suggestion-error" role="alert">{t("assistant.patchNeedRegen")}: {suggestion.patchError.message}</div>}
                      {suggestion.previews?.length ? (
                        <div className="suggestion-diffs">
                          {suggestion.previews.map((preview, index) => {
                            const diff = splitTextDiff(preview.before, preview.after);
                            return (
                            <div key={`${preview.path}-${preview.op}-${index}`} className="suggestion-diff">
                              <div className="suggestion-diff-meta"><span className="suggestion-diff-op">{preview.op}</span><span className="suggestion-diff-path">{preview.path}</span></div>
                              <div className="suggestion-diff-label">before</div>
                              <pre className="suggestion-diff-block is-before">{diff.prefix}<mark>{diff.beforeChanged}</mark>{diff.suffix}</pre>
                              <div className="suggestion-diff-label">after</div>
                              <pre className="suggestion-diff-block is-after">{diff.prefix}<mark>{diff.afterChanged}</mark>{diff.suffix}</pre>
                            </div>
                          )})}
                        </div>
                      ) : <div className="suggestion-body">{suggestion.body}</div>}
                      <div className="suggestion-actions">
                        <button className="btn btn-primary" type="button" disabled={!canKeep} onClick={() => props.onKeep(message)}>{kept ? t("assistant.kept") : t("assistant.keep")}</button>
                        <button className="btn btn-secondary" type="button" disabled={!canSecondary} onClick={() => props.onUndo(message)}>{status === "applied" ? t("assistant.undo") : t("common.cancel")}</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="ai-composer">
            <div className="prompt-chips">{props.quickPrompts.map((prompt) => <button key={prompt} className="chip" type="button" onClick={() => props.onSend(prompt)}>{prompt}</button>)}</div>
            <div className="composer-box">
              <textarea className="composer-input" placeholder={t("assistant.placeholder")} value={props.draft} rows={1} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => props.onDraftChange(event.currentTarget.value)} onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); props.onSend(props.draft); } }} />
              {props.sending ? (
                <button className="send-btn is-stop" type="button" onClick={props.onStop} aria-label={t("assistant.stop")} title={t("assistant.stop")}><IconStop /></button>
              ) : (
                <button className="send-btn" type="button" disabled={!props.draft.trim()} onClick={() => props.onSend(props.draft)} aria-label={t("assistant.send")}><IconSend /></button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
