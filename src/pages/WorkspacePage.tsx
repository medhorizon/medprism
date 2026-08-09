import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AssistantCard } from "../components/AssistantCard";
import { FileTree } from "../components/FileTree";
import { PreviewPane } from "../components/PreviewPane";
import { ProviderSettingsModal } from "../components/ProviderSettingsModal";
import { ResizeHandle } from "../components/ResizeHandle";
import { SourcePane } from "../components/SourcePane";
import { Topbar } from "../components/Topbar";
import { runAssistant } from "../lib/assistantRuntime";
import { compileProject } from "../lib/compileClient";
import { isUsableLlmConfig, LlmClientError, type ChatRequestMessage } from "../lib/llmClient";
import {
  applySuggestionToFiles,
  withSuggestionStatus,
} from "../lib/suggestions";
import { useI18n } from "../i18n/context";
import { DEMO_PROJECT_ID } from "../data/sample";
import { loadAuth } from "../state/auth";
import { resolveLlmConfig } from "../state/llm";
import {
  ensureDemoProject,
  getProject,
  migrateLocalProjects,
  upsertProject,
  type Project,
} from "../state/projects";
import { filesToFileList } from "../templates";
import type { ChatMessage } from "../types/chat";

const FILES_MIN = 160;
const FILES_MAX = 360;
const PREVIEW_MIN = 280;
const PREVIEW_MAX = 720;
const MAX_FIX_RECOMPILES = 2;

function isDemoProject(p: Project | null | undefined) {
  return !!p && (p.id === DEMO_PROJECT_ID || p.templateId === "demo-sample");
}

export function WorkspacePage() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();

  const [project, setProject] = useState<Project | null>(() => {
    migrateLocalProjects();
    ensureDemoProject();
    return getProject(projectId) ?? null;
  });

  const [activeFile, setActiveFile] = useState("main.tex");
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [aiOpen, setAiOpen] = useState(true);
  const [aiHeight, setAiHeight] = useState(280);
  const [filesWidth, setFilesWidth] = useState(220);
  const [previewWidth, setPreviewWidth] = useState(420);
  const [compiling, setCompiling] = useState(false);
  const [compiled, setCompiled] = useState(true);
  const [compileFailed, setCompileFailed] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(100);
  const [toast, setToast] = useState<string | null>(null);
  const [providerOpen, setProviderOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [auth, setAuth] = useState(() => loadAuth());
  useEffect(() => {
    setAuth(loadAuth());
  }, [projectId]);
  const [lastCompileLog, setLastCompileLog] = useState<string>("");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const fixRetriesRef = useRef(0);
  const pdfUrlRef = useRef<string | null>(null);

  const demo = isDemoProject(project);

  const quickPrompts = useMemo(() => {
    const reviewChip = t("assistant.qReview");
    if (demo) {
      return [
        t("assistant.demo.q1"),
        t("assistant.demo.q2"),
        t("assistant.demo.q3"),
        t("assistant.demo.q4"),
        reviewChip,
      ];
    }
    return [
      t("assistant.q1"),
      t("assistant.q2"),
      t("assistant.q3"),
      t("assistant.q4"),
      reviewChip,
    ];
  }, [demo, t]);

  useEffect(() => {
    migrateLocalProjects();
    ensureDemoProject();
    const p = getProject(projectId);
    if (!p) {
      setProject(null);
      return;
    }
    setProject(p);
    const order = p.fileOrder ?? Object.keys(p.files);
    const preferred =
      (p.mainFile && p.files[p.mainFile] ? p.mainFile : undefined) ??
      order.find((k) => k in p.files) ??
      Object.keys(p.files)[0];
    setActiveFile(preferred);
    const welcome = isDemoProject(p) ? t("assistant.demo.initial") : t("assistant.initial");
    setChat([
      {
        id: "a1",
        role: "assistant",
        content: welcome,
      },
    ]);
    setCompiled(true);
    setCompileFailed(false);
    fixRetriesRef.current = 0;
  }, [projectId, t]);

  useEffect(() => {
    return () => {
      if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
    };
  }, []);

  const fileEntries = useMemo(() => {
    if (!project) return [];
    return filesToFileList(project.files, project.fileOrder);
  }, [project]);

  const source = project?.files[activeFile] ?? "";

  const preview = useMemo(
    () => ({
      title: project?.title ?? t("templates.untitled"),
      authors: t("workspace.previewAuthors"),
    }),
    [project?.title, t],
  );

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 1800);
  }

  function persist(next: Project) {
    const saved = {
      ...next,
      updatedAt: new Date().toISOString(),
    };
    upsertProject(saved);
    setProject(saved);
  }

  function setPdfFromBase64(pdfBase64?: string) {
    if (!pdfBase64) return;
    const binary = atob(pdfBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
    pdfUrlRef.current = url;
    setPdfUrl(url);
  }

  async function compile() {
    if (!project || compiling) return;
    setCompiling(true);
    setCompiled(false);
    setCompileFailed(false);

    const mainFile =
      project.mainFile && project.files[project.mainFile]
        ? project.mainFile
        : Object.keys(project.files).find((k) => /(^|\/)main\.tex$/i.test(k)) ||
          Object.keys(project.files).find((k) => k.endsWith(".tex")) ||
          "main.tex";

    const result = await compileProject({
      files: project.files,
      mainFile,
    });

    setLastCompileLog(result.log || result.error || "");
    setCompiling(false);

    if (result.error && !result.log) {
      setCompileFailed(true);
      setCompiled(false);
      flash(t("workspace.toastCompileOffline"));
      return;
    }

    if (result.ok && result.pdfBase64) {
      setPdfFromBase64(result.pdfBase64);
      setCompiled(true);
      setCompileFailed(false);
      flash(t("workspace.toastCompiled"));
      return;
    }

    setCompileFailed(true);
    setCompiled(false);
    flash(t("workspace.toastCompileFailed"));
  }

  function llmErrorMessage(err: unknown): string {
    if (err instanceof LlmClientError) {
      if (err.code === "not_configured") return t("assistant.needConfig");
      if (err.code === "unauthorized") return t("assistant.errorUnauthorized");
      if (err.code === "cors_or_network" || err.code === "network") {
        return t("assistant.errorNetwork");
      }
      if (err.code === "bad_response") return t("assistant.errorBadResponse");
      if (
        err.status === 503 ||
        /upstream_not_configured/i.test(err.message)
      ) {
        return t("assistant.errorUpstream");
      }
      return t("assistant.errorHttp", { detail: err.message });
    }
    return t("assistant.errorNetwork");
  }

  async function send(text: string) {
    const prompt = text.trim();
    if (!prompt || sending || !project) return;

    const config = resolveLlmConfig();
    if (!isUsableLlmConfig(config)) {
      setChat((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "user", content: prompt },
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: t("assistant.needConfig"),
        },
      ]);
      setDraft("");
      setProviderOpen(true);
      return;
    }

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: prompt,
    };
    const thinkingId = crypto.randomUUID();
    setChat((prev) => [
      ...prev,
      userMsg,
      { id: thinkingId, role: "assistant", content: t("assistant.thinking") },
    ]);
    setDraft("");
    setSending(true);

    const history: ChatRequestMessage[] = [...chat, userMsg]
      .filter((m) => m.id !== "a1")
      .slice(-12)
      .map((m) => ({
        role: m.role,
        content: m.content,
      }));

    try {
      const reviewChip = t("assistant.qReview");
      const forceReview =
        prompt.trim() === reviewChip ||
        prompt.trim() === t("assistant.review.q1");

      const result = await runAssistant({
        mode: "assistant",
        config,
        userText: forceReview ? t("assistant.review.q1") : prompt,
        history,
        // 快捷芯片「审阅论文」或自然语言审稿意图 → review skill
        intent: forceReview ? "review" : "auto",
        ctx: {
          projectId: project.id,
          files: project.files,
          mainFile: project.mainFile,
          lastCompileLog,
        },
      });

      if (result.lastCompileLog) setLastCompileLog(result.lastCompileLog);
      if (result.pdfBase64) {
        setPdfFromBase64(result.pdfBase64);
        setCompiled(true);
        setCompileFailed(false);
      }

      const notes =
        result.toolNotes.length > 0
          ? `\n\n_${result.toolNotes.join(" · ")}_`
          : "";

      const primarySuggestion = result.suggestions[0];
      const extra =
        result.suggestions.length > 1
          ? result.suggestions.slice(1).map((s) => ({
              id: crypto.randomUUID(),
              role: "assistant" as const,
              content: s?.title ? `Additional suggestion: ${s.title}` : "Additional suggestion",
              suggestion: s,
            }))
          : [];

      setChat((prev) => {
        const next = prev.map((m) =>
          m.id === thinkingId
            ? {
                ...m,
                content: `${result.content}${notes}`,
                suggestion: primarySuggestion,
              }
            : m,
        );
        return extra.length ? [...next, ...extra] : next;
      });
    } catch (err) {
      const message = llmErrorMessage(err);
      setChat((prev) =>
        prev.map((m) => (m.id === thinkingId ? { ...m, content: message } : m)),
      );
      if (err instanceof LlmClientError && err.code === "not_configured") {
        setProviderOpen(true);
      }
    } finally {
      setSending(false);
    }
  }

  async function keepSuggestion(message: ChatMessage) {
    if (!project || !message.suggestion || message.suggestion.status === "applied") return;

    const result = applySuggestionToFiles(project.files, message);
    if (!result) return;

    setActiveFile(result.target);
    const nextProject = { ...project, files: result.files };
    persist(nextProject);
    setChat((msgs) =>
      withSuggestionStatus(msgs, message.id, {
        status: "applied",
        appliedTo: result.target,
        previousContent: result.previousContent,
        path: message.suggestion?.path,
      }),
    );
    setCompiled(false);
    flash(t("workspace.toastKept"));

    // Tools mode: auto recompile after compile-fix Keep (max 2)
    const looksLikeFix =
      /\.tex/i.test(result.target) &&
      (compileFailed || /compile|error|fix|警告|编译/i.test(message.content + message.suggestion.title));

    if (looksLikeFix && fixRetriesRef.current < MAX_FIX_RECOMPILES) {
      fixRetriesRef.current += 1;
      flash(t("workspace.toastRecompiling"));
      setCompiling(true);
      const mainFile =
        nextProject.mainFile && nextProject.files[nextProject.mainFile]
          ? nextProject.mainFile
          : Object.keys(nextProject.files).find((k) => /(^|\/)main\.tex$/i.test(k)) ||
            Object.keys(nextProject.files).find((k) => k.endsWith(".tex")) ||
            "main.tex";
      const compiledResult = await compileProject({
        files: nextProject.files,
        mainFile,
      });
      setLastCompileLog(compiledResult.log || compiledResult.error || "");
      setCompiling(false);
      if (compiledResult.ok && compiledResult.pdfBase64) {
        setPdfFromBase64(compiledResult.pdfBase64);
        setCompiled(true);
        setCompileFailed(false);
        fixRetriesRef.current = 0;
        flash(t("workspace.toastCompiled"));
      } else {
        setCompileFailed(true);
        setCompiled(false);
        flash(t("workspace.toastCompileFailed"));
      }
    }
  }

  function undoSuggestion(message: ChatMessage) {
    if (!project) return;
    const suggestion = message.suggestion;
    if (!suggestion) return;

    if (
      suggestion.status === "applied" &&
      suggestion.appliedTo &&
      suggestion.previousContent != null
    ) {
      const target = suggestion.appliedTo;
      setActiveFile(target);
      persist({
        ...project,
        files: { ...project.files, [target]: suggestion.previousContent },
      });
      setChat((msgs) =>
        withSuggestionStatus(msgs, message.id, {
          status: "undone",
          previousContent: undefined,
          appliedTo: undefined,
        }),
      );
      setCompiled(false);
      flash(t("workspace.toastUndone"));
      return;
    }

    if (suggestion.status !== "applied") {
      setChat((msgs) =>
        withSuggestionStatus(msgs, message.id, { status: "dismissed" }),
      );
      flash(t("workspace.toastDismissed"));
    }
  }

  function fixWithAi() {
    setAiOpen(true);
    void send(demo ? t("assistant.demo.q4") : t("assistant.q4"));
  }

  if (!project) {
    return (
      <div className="shell-page">
        <div className="shell-card">
          <h1 className="shell-title">{t("workspace.notFound")}</h1>
          <p className="shell-copy">{t("workspace.notFoundCopy")}</p>
          <Link className="btn btn-primary" to="/projects">
            {t("workspace.back")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <Topbar
        projectName={project.title}
        compiling={compiling}
        compiled={compiled && !compileFailed}
        aiOpen={aiOpen}
        onToggleAssistant={() => setAiOpen((v) => !v)}
        onExport={() => flash(t("workspace.toastExported"))}
        onCompile={() => void compile()}
        onProjectClick={() => navigate("/projects")}
        onApiSettings={() => setProviderOpen(true)}
      />

      <main
        className="workspace"
        style={{
          gridTemplateColumns: `${filesWidth}px 5px minmax(0, 1fr) 5px ${previewWidth}px`,
        }}
      >
        <FileTree
          files={fileEntries}
          activeFileId={activeFile}
          onSelect={setActiveFile}
          accountLabel={
            auth.status === "authenticated"
              ? auth.displayName || auth.contact || t("common.guest")
              : t("common.signIn")
          }
          onAccountClick={() => {
            setAuth(loadAuth());
            navigate(
              auth.status === "authenticated" ? "/projects" : "/login?mode=login",
            );
          }}
          onApiSettings={() => setProviderOpen(true)}
        />

        <ResizeHandle
          label={t("resize.files")}
          onResize={(dx) =>
            setFilesWidth((w) => Math.min(FILES_MAX, Math.max(FILES_MIN, w + dx)))
          }
        />

        <section className="panel panel-center">
          <div className="source-stack">
            <SourcePane
              fileName={activeFile}
              value={source}
              onChange={(value) => {
                persist({
                  ...project,
                  files: { ...project.files, [activeFile]: value },
                });
                setCompiled(false);
              }}
              onFixWithAi={fixWithAi}
            />

            {aiOpen && (
              <AssistantCard
                height={aiHeight}
                onHeightChange={setAiHeight}
                onCollapse={() => setAiOpen(false)}
                chat={chat}
                draft={draft}
                onDraftChange={setDraft}
                onSend={(text) => void send(text)}
                quickPrompts={quickPrompts}
                onKeep={(m) => void keepSuggestion(m)}
                onUndo={undoSuggestion}
                sending={sending}
              />
            )}
          </div>
        </section>

        <ResizeHandle
          label={t("resize.preview")}
          invert
          onResize={(dx) =>
            setPreviewWidth((w) => Math.min(PREVIEW_MAX, Math.max(PREVIEW_MIN, w + dx)))
          }
        />

        <PreviewPane
          zoom={previewZoom}
          onZoomChange={setPreviewZoom}
          compiling={compiling}
          compiled={compiled}
          onCompile={() => void compile()}
          onFixWithAi={fixWithAi}
          title={preview.title}
          authors={preview.authors}
          pdfUrl={pdfUrl}
          compileFailed={compileFailed}
        />
      </main>

      <ProviderSettingsModal open={providerOpen} onClose={() => setProviderOpen(false)} />

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
