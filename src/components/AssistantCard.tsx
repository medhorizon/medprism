import { useRef, type PointerEvent } from "react";
import { useI18n } from "../i18n/context";
import type { ChatMessage } from "../types/chat";

type AssistantCardProps = {
  height: number;
  onHeightChange: (height: number) => void;
  onCollapse: () => void;
  chat: ChatMessage[];
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: (text: string) => void;
  quickPrompts: string[];
  onKeep: (message: ChatMessage) => void;
  onUndo: (message: ChatMessage) => void;
  sending?: boolean;
};

function IconSend() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2.5 8h11M9 3.5 13.5 8 9 12.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AssistantCard({
  height,
  onHeightChange,
  onCollapse,
  chat,
  draft,
  onDraftChange,
  onSend,
  quickPrompts,
  onKeep,
  onUndo,
  sending,
}: AssistantCardProps) {
  const { t } = useI18n();
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  function onResizeStart(e: PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startH: height };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
  }

  function onResizeMove(e: PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    const delta = dragRef.current.startY - e.clientY;
    onHeightChange(Math.min(560, Math.max(180, dragRef.current.startH + delta)));
  }

  function onResizeEnd() {
    dragRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }

  return (
    <div className="ai-float" role="dialog" aria-label={t("assistant.title")}>
      <div className="ai-card" style={{ height }}>
        <div
          className="ai-resize"
          onPointerDown={onResizeStart}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeEnd}
          onPointerCancel={onResizeEnd}
          role="separator"
          aria-orientation="horizontal"
          aria-label={t("assistant.resize")}
          title={t("assistant.resize")}
        >
          <span className="ai-grip" />
        </div>

        <div className="ai-card-bar">
          <span className="ai-card-title">{t("assistant.title")}</span>
          <div className="panel-head-actions">
            <button
              className="icon-btn"
              type="button"
              title={t("assistant.collapse")}
              onClick={onCollapse}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path
                  d="M4 6.5 8 10.5 12 6.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>

        <div className="ai-body">
          <div className="ai-thread">
            {chat.map((message) => {
              const status = message.suggestion?.status ?? "pending";
              const kept = status === "applied";
              const dismissed = status === "dismissed";
              const canKeep = status === "pending" || status === "undone";
              const canUndo = status === "applied" || status === "pending";

              return (
                <div key={message.id} className={`msg ${message.role}`}>
                  <div className="msg-role">
                    {message.role === "assistant" ? "MedPrism" : t("assistant.you")}
                  </div>
                  <div className="msg-bubble">{message.content}</div>
                  {message.suggestion && !dismissed && (
                    <div className={`suggestion ${kept ? "is-kept" : ""}`}>
                      <div className="suggestion-head">{message.suggestion.title}</div>
                      <div className="suggestion-body">{message.suggestion.body}</div>
                      <div className="suggestion-actions">
                        <button
                          className="btn btn-primary"
                          type="button"
                          disabled={!canKeep}
                          onClick={() => onKeep(message)}
                        >
                          {kept ? t("assistant.kept") : t("assistant.keep")}
                        </button>
                        <button
                          className="btn btn-secondary"
                          type="button"
                          disabled={!canUndo}
                          onClick={() => onUndo(message)}
                        >
                          {t("assistant.undo")}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="ai-composer">
            <div className="prompt-chips">
              {quickPrompts.map((p) => (
                <button key={p} className="chip" type="button" onClick={() => onSend(p)}>
                  {p}
                </button>
              ))}
            </div>
            <div className="composer-box">
              <textarea
                className="composer-input"
                placeholder={t("assistant.placeholder")}
                value={draft}
                rows={1}
                onChange={(e) => onDraftChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    onSend(draft);
                  }
                }}
              />
              <button
                className="send-btn"
                type="button"
                disabled={!draft.trim() || !!sending}
                onClick={() => onSend(draft)}
                aria-label={t("assistant.send")}
              >
                <IconSend />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
