import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { useI18n } from "../i18n/context";
import { MAX_PROJECT_MEMORY_CHARS } from "../lib/projectMemory";
import type { ChatMessage } from "../types/chat";

type AssistantCardProps = {
  height: number | "60%";
  onHeightChange: (height: number) => void;
  onCollapse: () => void;
  chat: ChatMessage[];
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: (text: string) => void;
  onStop?: () => void;
  quickPrompts: string[];
  onKeep: (message: ChatMessage) => void;
  onUndo: (message: ChatMessage) => void;
  onConfirm: (message: ChatMessage) => void;
  onCancelConfirmation: (message: ChatMessage) => void;
  onSelectDisambiguation: (message: ChatMessage, choiceId: string) => void;
  onCancelDisambiguation: (message: ChatMessage) => void;
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
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="4" y="4" width="8" height="8" rx="1.25" fill="currentColor" />
    </svg>
  );
}

function DiffBlock(props: { kind: "before" | "after"; text: string }) {
  const marker = props.kind === "before" ? "-" : "+";
  const lines = props.text.replace(/\r\n?/g, "\n").split("\n");

  return (
    <pre className={`suggestion-diff-block is-${props.kind}`}>
      <code>
        {lines.map((line, index) => (
          <span className="suggestion-diff-line" key={`${index}-${line}`}>
            <span className="suggestion-diff-gutter" aria-hidden>{marker}</span>
            <span className="suggestion-diff-code">{line || " "}</span>
          </span>
        ))}
      </code>
    </pre>
  );
}

export function AssistantCard(props: AssistantCardProps) {
  const { t } = useI18n();
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memoryDraft, setMemoryDraft] = useState(props.memoryNotes ?? "");

  useEffect(() => {
    setMemoryDraft(props.memoryNotes ?? "");
  }, [props.memoryNotes]);

  useEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;
    const frame = window.requestAnimationFrame(() => {
      thread.scrollTop = thread.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [props.chat, props.sending]);

  function flushMemory(next: string = memoryDraft) {
    props.onMemoryNotesChange?.(next);
  }

  function onResizeStart(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const measuredHeight = event.currentTarget.parentElement?.getBoundingClientRect().height;
    dragRef.current = {
      startY: event.clientY,
      startH: measuredHeight ?? (typeof props.height === "number" ? props.height : 0),
    };
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
      <div className="ai-card" style={{ height: typeof props.height === "number" ? `${props.height}px` : "100%" }}>
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
              const confirmation = message.confirmation;
              const disambiguation = message.disambiguation;
              const status = suggestion?.status ?? "pending";
              const kept = status === "applied";
              const dismissed = status === "dismissed";
              const canKeep = (status === "pending" || status === "undone") && Boolean(suggestion?.patchSet) && !suggestion?.patchError && !suggestion?.legacyDisplayOnly;
              const canSecondary = status === "applied" || status === "pending" || status === "undone";
              return (
                <div key={message.id} className={`msg ${message.role}`}>
                  <div className="msg-role">{message.role === "assistant" ? "MedPrism" : t("assistant.you")}</div>
                  <div className="msg-bubble">{message.content}</div>
                  {disambiguation && disambiguation.status !== "superseded" && (
                    <div className={`suggestion ${disambiguation.status === "selected" ? "is-kept" : ""}`}>
                      <div className="suggestion-head">Choose target</div>
                      <div className="suggestion-body">
                        {disambiguation.task.choices.map((choice, index) => (
                          <div key={choice.id}>
                            {index + 1}. {choice.slot} · {choice.path}
                            {choice.preview ? `\n${choice.preview}` : ""}
                          </div>
                        ))}
                      </div>
                      {disambiguation.status === "awaiting-disambiguation" ? (
                        <div className="suggestion-actions">
                          {disambiguation.task.choices.map((choice, index) => (
                            <button className="btn btn-secondary" type="button" key={choice.id} onClick={() => props.onSelectDisambiguation(message, choice.id)}>
                              {index + 1}
                            </button>
                          ))}
                          <button className="btn btn-secondary" type="button" onClick={() => props.onCancelDisambiguation(message)}>{t("common.cancel")}</button>
                        </div>
                      ) : (
                        <div className="suggestion-body">{disambiguation.status === "selected" ? "Target selected." : "Target selection cancelled."}</div>
                      )}
                    </div>
                  )}
                  {confirmation && confirmation.status !== "superseded" && (
                    <div className={`suggestion ${confirmation.status === "confirmed" ? "is-kept" : ""}`}>
                      <div className="suggestion-head">{t("assistant.confirmTitle")}</div>
                      <div className="suggestion-body">
                        {confirmation.task.targets.map((target) => `${target.slot}${target.path ? ` · ${target.path}` : ""}`).join("\n") || t("assistant.confirmSelection")}
                      </div>
                      {confirmation.status === "awaiting-confirmation" ? (
                        <div className="suggestion-actions">
                          <button className="btn btn-primary" type="button" onClick={() => props.onConfirm(message)}>{t("assistant.confirmContinue")}</button>
                          <button className="btn btn-secondary" type="button" onClick={() => props.onCancelConfirmation(message)}>{t("common.cancel")}</button>
                        </div>
                      ) : (
                        <div className="suggestion-body">{confirmation.status === "confirmed" ? t("assistant.confirmed") : t("assistant.confirmCancelled")}</div>
                      )}
                    </div>
                  )}
                  {suggestion && !dismissed && (
                    <div className={`suggestion ${kept ? "is-kept" : ""}`}>
                      <div className="suggestion-head">{suggestion.title}</div>
                      {suggestion.patchError && <div className="suggestion-error" role="alert">{t("assistant.patchNeedRegen")}: {suggestion.patchError.message}</div>}
                      {suggestion.previews?.length ? (
                        <div className="suggestion-diffs">
                          {suggestion.previews.map((preview, index) => (
                            <div key={`${preview.path}-${preview.op}-${index}`} className="suggestion-diff">
                              <div className="suggestion-diff-meta"><span className="suggestion-diff-op">{preview.op}</span><span className="suggestion-diff-path">{preview.path}</span></div>
                              <div className="suggestion-diff-label is-before"><span aria-hidden>-</span> before</div>
                              <DiffBlock kind="before" text={preview.before} />
                              <div className="suggestion-diff-label is-after"><span aria-hidden>+</span> after</div>
                              <DiffBlock kind="after" text={preview.after} />
                            </div>
                          ))}
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
              <textarea
                className="composer-input"
                placeholder={t("assistant.placeholder")}
                value={props.draft}
                rows={1}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) => props.onDraftChange(event.currentTarget.value)}
                onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    if (props.sending) return;
                    props.onSend(props.draft);
                  }
                }}
              />
              {props.sending ? (
                <button
                  className="send-btn is-stop"
                  type="button"
                  onClick={() => props.onStop?.()}
                  aria-label={t("assistant.stop")}
                  title={t("assistant.stop")}
                >
                  <IconStop />
                </button>
              ) : (
                <button
                  className="send-btn"
                  type="button"
                  disabled={!props.draft.trim()}
                  onClick={() => props.onSend(props.draft)}
                  aria-label={t("assistant.send")}
                  title={t("assistant.send")}
                >
                  <IconSend />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
