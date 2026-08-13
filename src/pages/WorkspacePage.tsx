import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AssistantCard } from "../components/AssistantCard";
import { FileTree } from "../components/FileTree";
import { PreviewPane } from "../components/PreviewPane";
import { ProviderSettingsModal } from "../components/ProviderSettingsModal";
import { ResizeHandle } from "../components/ResizeHandle";
import { SourcePane } from "../components/SourcePane";
import { Topbar } from "../components/Topbar";
import type { WorkflowKind } from "../lib/workflows/types";
import { compileProject } from "../lib/compileClient";
import { projectRevision } from "../lib/patch/revision";
import { downloadProjectZip } from "../lib/exportZip";
import { toLlmHistory } from "../lib/chatHistory";
import { isUsableLlmConfig, LlmClientError } from "../lib/llmClient";
import {
  compiledPdfPath,
  decodeBinaryFile,
  encodeBinaryBytes,
  withCompiledPdfFiles,
} from "../lib/projectBinary";
import { withSuggestionStatus } from "../lib/suggestions";
import type { TextSelection } from "../lib/context/snapshot";
import type { PdfTextSelection } from "../components/pdfSelection";
import { locatePdfTextInSource } from "../lib/pdfSourceLocation";
import { decodeSyncTexBase64, syncTexCandidatesForSelection } from "../lib/synctex";
import { useI18n } from "../i18n/context";
import { DEMO_PROJECT_ID } from "../data/sample";
import { loadAuth } from "../state/auth";
import { resolveLlmConfig } from "../state/llm";
import {
  clearProjectPdf,
  loadProjectChat,
  loadProjectMemory,
  loadProjectPdf,
  saveProjectMemory,
} from "../state/projectArtifacts";
import {
  adoptProjectChat,
  getSessionChat,
  isSessionSending,
  persistDurableChat,
  setSessionChat,
  shutdownProjectChats,
  startProjectAssistant,
  stopProjectAssistant,
  subscribeProjectChat,
} from "../state/projectChatSession";
import {
  ensureDemoProject,
  getLastProjectStoreError,
  getProject,
  migrateLocalProjects,
  upsertProjectResult,
  type Project,
} from "../state/projects";
import {
  PROJECT_SOFT_LIMIT_BYTES,
  ProjectStore,
  estimateProjectBytes,
} from "../state/projectStore";
import { ProjectSaveQueue } from "../state/projectSaveQueue";
import { projectStorage } from "../state/projectStorage";
import {
  keepSuggestionTransaction,
  undoSuggestionTransaction,
} from "../state/projectTransactions";
import { filesToFileList } from "../templates";
import type { ChatMessage } from "../types/chat";

const FILES_MIN = 160;
const FILES_MAX = 360;
const PREVIEW_MIN = 280;
const PREVIEW_MAX = 720;
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "pdf"]);

function isDemoProject(project: Project | null | undefined) {
  return !!project &&
    (project.id === DEMO_PROJECT_ID || project.templateId === "demo-sample");
}

function initialProject(projectId: string): Project | null {
  const migration = migrateLocalProjects();
  if (migration.ok) {
    try {
      ensureDemoProject();
    } catch {
      // The typed storage error is shown after the component mounts.
    }
  }
  return getProject(projectId) ?? null;
}

export function WorkspacePage() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [project, setProject] = useState<Project | null>(() => initialProject(projectId));
  const projectRef = useRef<Project | null>(project);
  const [activeFile, setActiveFile] = useState("main.tex");
  const [selection, setSelection] = useState<TextSelection | undefined>();
  const [cursor, setCursor] = useState(0);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const chatRef = useRef<ChatMessage[]>(chat);
  const [draft, setDraft] = useState("");
  const [memoryNotes, setMemoryNotes] = useState("");
  const [aiOpen, setAiOpen] = useState(true);
  const [aiHeight, setAiHeight] = useState(() =>
    Math.min(560, Math.max(180, Math.round((window.innerHeight - 48) / 2))),
  );
  const [filesWidth, setFilesWidth] = useState(220);
  const [previewWidth, setPreviewWidth] = useState(420);
  const [compiling, setCompiling] = useState(false);
  const compilingRef = useRef(false);
  const [compiled, setCompiled] = useState(false);
  const [compileFailed, setCompileFailed] = useState(false);
  const [autoCompile, setAutoCompile] = useState(() => {
    try {
      return localStorage.getItem("medprism.autoCompile") === "1";
    } catch {
      return false;
    }
  });
  const [toast, setToast] = useState<string | null>(null);
  const [providerOpen, setProviderOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [auth, setAuth] = useState(() => loadAuth());
  const [lastCompileLog, setLastCompileLog] = useState("");
  const lastCompileLogRef = useRef("");
  const [imageDragActive, setImageDragActive] = useState(false);
  const imageDragDepthRef = useRef(0);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [syncTexSource, setSyncTexSource] = useState<string | null>(null);
  const [revealedSelection, setRevealedSelection] = useState<TextSelection | undefined>();
  const pdfUrlRef = useRef<string | null>(null);
  const compileControllerRef = useRef<AbortController | null>(null);
  const compileRunRef = useRef(0);
  const autoCompileRef = useRef(autoCompile);
  const autoCompileTimerRef = useRef<number | null>(null);
  const storeRef = useRef<ProjectStore | null>(null);
  const saveQueueRef = useRef<ProjectSaveQueue | null>(null);
  const mountedRef = useRef(true);
  const sizeWarningProjectRef = useRef<string | null>(null);
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  const interruptedLabelRef = useRef(t("assistant.interrupted"));
  interruptedLabelRef.current = t("assistant.interrupted");

  function syncChatFromSession(id: string) {
    setChat(getSessionChat(id));
    setSending(isSessionSending(id));
  }

  function updateChat(
    updater: ChatMessage[] | ((previous: ChatMessage[]) => ChatMessage[]),
    options?: { persist?: boolean },
  ) {
    const id = projectRef.current?.id;
    if (!id) {
      setChat(updater);
      return;
    }
    const next = setSessionChat(id, updater, options);
    setChat(next);
    setSending(isSessionSending(id));
  }

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 2200);
  }

  function setProjectState(next: Project | null) {
    projectRef.current = next;
    setProject(next);
  }

  if (!storeRef.current) storeRef.current = new ProjectStore(projectStorage());
  if (!saveQueueRef.current) {
    saveQueueRef.current = new ProjectSaveQueue(
      storeRef.current,
      () => projectRef.current,
      {
        onSaved: (saved) => {
          if (!mountedRef.current) return;
          const current = projectRef.current;
          if (!current || current.id !== saved.id) return;
          setProjectState({ ...current, revision: saved.revision });
          if (
            !window.medprismDesktop &&
            estimateProjectBytes(saved) >= PROJECT_SOFT_LIMIT_BYTES &&
            sizeWarningProjectRef.current !== saved.id
          ) {
            sizeWarningProjectRef.current = saved.id;
            flash("项目体积较大。请导出 ZIP 备份，并避免继续加入二进制文件。");
          }
        },
        onError: (failure) => {
          if (!mountedRef.current) return;
          flash(
            failure.error.code === "QUOTA_EXCEEDED"
              ? "保存失败：本地存储空间不足，请立即导出备份。"
              : `保存失败：${failure.error.message}`,
          );
        },
        delayMs: 750,
      },
    );
  }

  const demo = isDemoProject(project);
  const quickPrompts = useMemo(() => {
    const review = t("assistant.qReview");
    return demo
      ? [
          t("assistant.demo.q1"),
          t("assistant.demo.q2"),
          t("assistant.demo.q3"),
          review,
          t("assistant.demo.q4"),
        ]
      : [
          t("assistant.q1"),
          t("assistant.q2"),
          t("assistant.q3"),
          review,
          t("assistant.q4"),
        ];
  }, [demo, t]);

  useEffect(() => {
    chatRef.current = chat;
  }, [chat]);

  useEffect(() => {
    return subscribeProjectChat(() => {
      const id = projectIdRef.current;
      if (!id) return;
      syncChatFromSession(id);
    });
  }, []);

  useEffect(() => {
    setAuth(loadAuth());
  }, [projectId]);

  useEffect(() => {
    return () => {
      const leaving = projectRef.current;
      if (!leaving) return;
      void saveQueueRef.current?.flush(leaving);
      // Keep in-flight assistant turns alive across workspace unmount / project switch.
      if (!isSessionSending(leaving.id)) {
        persistDurableChat(leaving.id, chatRef.current);
      }
    };
  }, [projectId]);

  useEffect(() => {
    const previousId = projectRef.current?.id;
    if (previousId && previousId !== projectId && !isSessionSending(previousId)) {
      persistDurableChat(previousId, getSessionChat(previousId));
    }
    if (pdfUrlRef.current) {
      URL.revokeObjectURL(pdfUrlRef.current);
      pdfUrlRef.current = null;
    }
    setPdfUrl(null);
    setSyncTexSource(null);
    setRevealedSelection(undefined);

    const next = initialProject(projectId);
    setProjectState(next);
    setSelection(undefined);
    setImageDragActive(false);
    imageDragDepthRef.current = 0;
    sizeWarningProjectRef.current = null;
    const storageError = getLastProjectStoreError();
    if (storageError) flash(`项目存储错误：${storageError.message}`);
    if (!next) {
      setChat([]);
      setMemoryNotes("");
      setSending(false);
      setCompiled(false);
      setCompileFailed(false);
      return;
    }
    const order = next.fileOrder ?? Object.keys(next.files);
    const preferred =
      (next.mainFile && next.files[next.mainFile] ? next.mainFile : undefined) ??
      order.find((path) => path in next.files) ??
      Object.keys(next.files)[0] ??
      "main.tex";
    setActiveFile(preferred);
    const savedChat = loadProjectChat(
      next.id,
      localStorage,
      interruptedLabelRef.current,
    );
    const fallback =
      savedChat && savedChat.length > 0
        ? savedChat
        : [
            {
              id: "a1",
              role: "assistant" as const,
              content: isDemoProject(next) ? t("assistant.demo.initial") : t("assistant.initial"),
            },
          ];
    const live = adoptProjectChat(next.id, fallback);
    setChat(live);
    setMemoryNotes(loadProjectMemory(next.id));
    setSending(isSessionSending(next.id));
    setCompiled(false);
    setCompileFailed(false);

    void (async () => {
      if (projectRef.current?.id !== next.id) return;
      const migrated = await hydratePdfForProject(next);
      if (migrated && projectRef.current?.id === migrated.id) {
        setProjectState(migrated);
      }
    })();
  }, [projectId, t]);

  useEffect(() => {
    if (!project?.id || chat.length === 0) return;
    if (chat.some((message) => message.pending) || isSessionSending(project.id)) return;
    const timer = window.setTimeout(() => {
      persistDurableChat(project.id, chat);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [chat, project?.id]);

  useEffect(() => {
    const saveBeforeUnload = () => {
      const current = projectRef.current;
      if (current) {
        const saved = storeRef.current?.saveProject(current, {
          expectedRevision: current.revision,
        });
        // beforeunload can be cancelled by the user. Keep the in-memory CAS revision
        // synchronized so subsequent edits do not fail against our own save.
        if (saved?.ok) projectRef.current = saved.value;
      }
      // Closing MedPrism: stop background turns and flush durable chat.
      shutdownProjectChats(interruptedLabelRef.current);
    };
    window.addEventListener("beforeunload", saveBeforeUnload);
    return () => window.removeEventListener("beforeunload", saveBeforeUnload);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      compileRunRef.current += 1;
      compileControllerRef.current?.abort();
      if (autoCompileTimerRef.current != null) {
        window.clearTimeout(autoCompileTimerRef.current);
        autoCompileTimerRef.current = null;
      }
      if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
    };
  }, []);

  useEffect(() => {
    autoCompileRef.current = autoCompile;
    try {
      localStorage.setItem("medprism.autoCompile", autoCompile ? "1" : "0");
    } catch {
      // ignore quota / private mode
    }
    if (!autoCompile && autoCompileTimerRef.current != null) {
      window.clearTimeout(autoCompileTimerRef.current);
      autoCompileTimerRef.current = null;
    }
  }, [autoCompile]);

  const fileEntries = useMemo(
    () => (project ? filesToFileList(project.files, project.fileOrder) : []),
    [project],
  );
  const source = project?.files[activeFile] ?? "";
  const preview = useMemo(
    () => ({
      title: project?.title ?? t("templates.untitled"),
      authors: t("workspace.previewAuthors"),
    }),
    [project?.title, t],
  );

  function setPdfFromBytes(bytes?: Uint8Array | null) {
    if (!bytes || bytes.length === 0) return;
    const copy = new Uint8Array(bytes);
    const url = URL.createObjectURL(new Blob([copy], { type: "application/pdf" }));
    if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
    pdfUrlRef.current = url;
    setPdfUrl(url);
  }

  function setPdfFromBase64(pdfBase64?: string) {
    if (!pdfBase64) return;
    const binary = atob(pdfBase64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    setPdfFromBytes(bytes);
  }

  function mainFileFor(current: Project): string {
    return (
      (current.mainFile && current.files[current.mainFile] ? current.mainFile : undefined) ??
      Object.keys(current.files).find((path) => /(^|\/)main\.tex$/i.test(path)) ??
      Object.keys(current.files).find((path) => path.toLowerCase().endsWith(".tex")) ??
      "main.tex"
    );
  }

  function pdfPathFor(current: Project): string {
    return compiledPdfPath(mainFileFor(current));
  }

  /** Load preview from project file; migrate legacy PDF cache into the project once. */
  async function hydratePdfForProject(current: Project): Promise<Project | null> {
    const pdfPath = pdfPathFor(current);
    const embedded = decodeBinaryFile(current.files[pdfPath] ?? "");
    if (embedded) {
      setPdfFromBytes(embedded);
      setCompiled(true);
      setCompileFailed(false);
      clearProjectPdf(current.id);
      return null;
    }

    const cached = loadProjectPdf(current.id);
    if (!cached?.pdfBase64) return null;
    const mainFile = mainFileFor(current);
    const attached = withCompiledPdfFiles(
      current.files,
      mainFile,
      cached.pdfBase64,
      current.fileOrder,
    );
    const saved = upsertProjectResult(
      {
        ...current,
        files: attached.files,
        ...(attached.fileOrder ? { fileOrder: attached.fileOrder } : {}),
        updatedAt: new Date().toISOString(),
      },
      current.revision,
    );
    if (!saved.ok) {
      setPdfFromBase64(cached.pdfBase64);
      setCompiled(true);
      setCompileFailed(false);
      return null;
    }
    clearProjectPdf(current.id);
    setPdfFromBase64(cached.pdfBase64);
    setCompiled(true);
    setCompileFailed(false);
    return saved.value;
  }

  async function persistCompiledPdf(
    projectId: string,
    mainFile: string,
    pdfBase64: string,
    baseFiles?: Record<string, string>,
  ): Promise<Project | null> {
    const current =
      projectRef.current?.id === projectId
        ? projectRef.current
        : getProject(projectId) ?? null;
    if (!current) return null;
    const sourceFiles = baseFiles ?? current.files;
    const attached = withCompiledPdfFiles(
      sourceFiles,
      mainFile,
      pdfBase64,
      current.fileOrder,
    );
    const saved = upsertProjectResult(
      {
        ...current,
        files: attached.files,
        ...(attached.fileOrder ? { fileOrder: attached.fileOrder } : {}),
        updatedAt: new Date().toISOString(),
      },
      current.revision,
    );
    if (!saved.ok) {
      flash(
        saved.error.code === "QUOTA_EXCEEDED"
          ? "保存 PDF 失败：本地存储空间不足，请导出 ZIP 备份。"
          : `保存 PDF 失败：${saved.error.message}`,
      );
      return null;
    }
    clearProjectPdf(projectId);
    if (projectRef.current?.id === projectId) {
      setProjectState(saved.value);
    }
    return saved.value;
  }

  async function compileSnapshot(current: Project): Promise<boolean> {
    const snapshotFiles = { ...current.files };
    const revision = await projectRevision(snapshotFiles);
    const controller = new AbortController();
    const runId = compileRunRef.current + 1;
    compileRunRef.current = runId;
    compileControllerRef.current?.abort();
    compileControllerRef.current = controller;
    compilingRef.current = true;
    setCompiling(true);
    setCompiled(false);
    setCompileFailed(false);

    const result = await compileProject(
      {
        jobId: crypto.randomUUID(),
        files: snapshotFiles,
        mainFile: mainFileFor(current),
        projectRevision: revision,
        synctex: true,
      },
      controller.signal,
    );
    if (compileRunRef.current !== runId) return false;
    compileControllerRef.current = null;
    const compileLog = result.log || result.error || "";
    lastCompileLogRef.current = compileLog;
    setLastCompileLog(compileLog);
    compilingRef.current = false;
    setCompiling(false);

    const latest = projectRef.current;
    const latestRevision = latest ? await projectRevision(latest.files) : "";
    if (!latest || latestRevision !== (result.projectRevision ?? revision)) {
      setCompiled(false);
      flash("编译完成，但源码已发生变化；结果未标记为当前版本。");
      return false;
    }

    if (result.ok && result.pdfBase64) {
      setSyncTexSource(result.synctexBase64 ? await decodeSyncTexBase64(result.synctexBase64) : null);
      setPdfFromBase64(result.pdfBase64);
      setCompiled(true);
      setCompileFailed(false);
      await persistCompiledPdf(
        current.id,
        mainFileFor(current),
        result.pdfBase64,
        latest.files,
      );
      flash(t("workspace.toastCompiled"));
      return true;
    }
    setCompileFailed(true);
    setCompiled(false);
    flash(
      result.code === "SERVICE_UNAVAILABLE"
        ? t("workspace.toastCompileOffline")
        : result.code === "ENGINE_UNAVAILABLE"
          ? t("workspace.toastCompileEngineMissing")
          : t("workspace.toastCompileFailed"),
    );
    return false;
  }

  function revealPdfSelection(pdfSelection: PdfTextSelection) {
    const current = projectRef.current;
    if (!current || !syncTexSource) return;
    const located = locatePdfTextInSource({
      selectedText: pdfSelection.text,
      candidates: syncTexCandidatesForSelection(syncTexSource, pdfSelection),
      files: current.files,
    });
    if (!located) return;
    setActiveFile(located.path);
    setSelection(located.selection);
    setCursor(located.selection.end);
    setRevealedSelection(located.selection);
  }

  async function compile() {
    if (!projectRef.current || compilingRef.current) return;
    if (autoCompileTimerRef.current != null) {
      window.clearTimeout(autoCompileTimerRef.current);
      autoCompileTimerRef.current = null;
    }
    await saveQueueRef.current?.flush();
    const latest = projectRef.current;
    if (latest) await compileSnapshot(latest);
  }

  function scheduleAutoCompile() {
    if (!autoCompileRef.current) return;
    if (autoCompileTimerRef.current != null) {
      window.clearTimeout(autoCompileTimerRef.current);
    }
    autoCompileTimerRef.current = window.setTimeout(() => {
      autoCompileTimerRef.current = null;
      if (!autoCompileRef.current || !mountedRef.current) return;
      void compile();
    }, 1800);
  }

  function toggleAutoCompile() {
    setAutoCompile((value) => {
      const next = !value;
      flash(next ? t("topbar.autoCompileOn") : t("topbar.autoCompileOff"));
      return next;
    });
  }

  function cancelCompile() {
    compileRunRef.current += 1;
    compileControllerRef.current?.abort();
    compileControllerRef.current = null;
    if (autoCompileTimerRef.current != null) {
      window.clearTimeout(autoCompileTimerRef.current);
      autoCompileTimerRef.current = null;
    }
    compilingRef.current = false;
    setCompiling(false);
    setCompiled(false);
    flash("编译已取消。");
  }

  function llmErrorMessage(error: unknown): string {
    if (error instanceof LlmClientError) {
      if (error.code === "not_configured") return t("assistant.needConfig");
      if (error.code === "unauthorized") return t("assistant.errorUnauthorized");
      if (error.code === "cors_or_network" || error.code === "network") {
        return t("assistant.errorNetwork");
      }
      if (error.code === "bad_response") return t("assistant.errorBadResponse");
      if (
        /upstream_not_configured/i.test(error.message) ||
        /"code"\s*:\s*"upstream_not_configured"/i.test(error.message)
      ) {
        return t("assistant.errorUpstream");
      }
      if (error.status === 503) {
        return t("assistant.errorHttp", {
          detail: error.message || "HTTP 503",
        });
      }
      return t("assistant.errorHttp", { detail: error.message });
    }
    return t("assistant.errorNetwork");
  }

  async function send(text: string, explicitWorkflow?: WorkflowKind) {
    const prompt = text.trim();
    const current = projectRef.current;
    if (!prompt || !current || isSessionSending(current.id)) return;
    const config = resolveLlmConfig();
    if (!isUsableLlmConfig(config)) {
      updateChat(
        (previous) => [
          ...previous,
          { id: crypto.randomUUID(), role: "user", content: prompt },
          { id: crypto.randomUUID(), role: "assistant", content: t("assistant.needConfig") },
        ],
        { persist: true },
      );
      setDraft("");
      setProviderOpen(true);
      return;
    }

    const requestProjectId = current.id;
    const requestFiles = { ...current.files };
    const requestMainFile = mainFileFor(current);
    const requestActiveFile = activeFile;
    const requestSelection = selection;
    const requestCursor = cursor;
    const requestCompileLog = lastCompileLogRef.current || lastCompileLog;
    const selectedText = requestSelection
      ? requestFiles[requestActiveFile]?.slice(requestSelection.start, requestSelection.end)
      : undefined;
    const history = toLlmHistory(getSessionChat(requestProjectId), prompt);
    const requestMemory = loadProjectMemory(requestProjectId);

    const reviewChip = t("assistant.qReview");
    const polishChip = t("assistant.q1");
    const logicChip = t("assistant.q2");
    const citeChip = t("assistant.q3");
    const compileChip = t("assistant.q4");
    const forceReview = prompt === reviewChip || prompt === t("assistant.review.q1");
    const chipWorkflow: WorkflowKind | undefined = forceReview
      ? "review"
      : prompt === polishChip
        ? "polish"
        : prompt === citeChip
          ? "citation"
          : prompt === compileChip || prompt === t("assistant.demo.q4")
            ? "compile-fix"
            : prompt === logicChip
              ? "review"
              : undefined;
    const chipUserText = forceReview
      ? t("assistant.review.q1")
      : prompt === logicChip
        ? t("assistant.q2.prompt")
        : prompt === polishChip
          ? t("assistant.q1.prompt")
          : prompt === citeChip
            ? t("assistant.q3.prompt")
            : prompt;
    setDraft("");
    setSending(true);

    try {
      await startProjectAssistant({
        projectId: requestProjectId,
        config,
        displayUserText: prompt,
        userText: chipUserText,
        history,
        workflow: explicitWorkflow ?? chipWorkflow ?? "auto",
        thinkingLabel: t("assistant.thinking"),
        mapError: llmErrorMessage,
        ctx: {
          projectId: requestProjectId,
          files: requestFiles,
          mainFile: requestMainFile,
          activeFile: requestActiveFile,
          cursor: requestCursor,
          ...(requestSelection ? { selection: requestSelection } : {}),
          ...(selectedText !== undefined ? { selectedText } : {}),
          ...(requestCompileLog ? { lastCompileLog: requestCompileLog } : {}),
          ...(requestMemory ? { memoryNotes: requestMemory } : {}),
        },
        onComplete: async (result) => {
          if (result.lastCompileLog && projectRef.current?.id === requestProjectId) {
            lastCompileLogRef.current = result.lastCompileLog;
            setLastCompileLog(result.lastCompileLog);
          }
          if (result.pdfBase64) {
            await persistCompiledPdf(
              requestProjectId,
              requestMainFile,
              result.pdfBase64,
              requestFiles,
            );
            if (projectRef.current?.id === requestProjectId) {
              setPdfFromBase64(result.pdfBase64);
              setCompiled(true);
              setCompileFailed(false);
            }
          }
        },
      });
    } catch (error) {
      if (error instanceof LlmClientError && error.code === "not_configured") {
        setProviderOpen(true);
      }
    } finally {
      if (projectRef.current?.id === requestProjectId) {
        setSending(isSessionSending(requestProjectId));
        setChat(getSessionChat(requestProjectId));
      }
    }
  }

  async function commitProject(next: Project, expectedRevision: number): Promise<Project> {
    const saved = upsertProjectResult(
      { ...next, updatedAt: new Date().toISOString() },
      expectedRevision,
    );
    if (!saved.ok) throw new Error(saved.error.message);
    setProjectState(saved.value);
    return saved.value;
  }

  async function keepSuggestion(message: ChatMessage) {
    if (!message.suggestion || message.suggestion.status === "applied") return;
    if (
      message.suggestion.legacyDisplayOnly ||
      message.suggestion.patchError ||
      !message.suggestion.patchSet
    ) {
      flash(t("assistant.patchNeedRegen"));
      return;
    }
    await saveQueueRef.current?.flush();
    try {
      const result = await keepSuggestionTransaction<Project>({
        getCurrent: () => projectRef.current,
        commit: commitProject,
        message,
      });
      if (!result.ok) {
        flash(result.error.message);
        updateChat(
          (messages) => withSuggestionStatus(messages, message.id, { patchError: result.error }),
          { persist: true },
        );
        return;
      }
      if (result.target) setActiveFile(result.target);
      setSelection(undefined);
      updateChat(
        (messages) => withSuggestionStatus(messages, message.id, result.suggestionPatch),
        { persist: true },
      );
      setCompiled(false);
      flash(t("workspace.toastKept"));
      if (result.verifyCompile) {
        flash(t("workspace.toastRecompiling"));
        const verified = await compileSnapshot(result.project);
        if (!verified && lastCompileLogRef.current.trim()) {
          await send(
            "Repair the first root error from the latest compile log with one minimal source replacement.",
            "compile-fix",
          );
        }
      } else if (autoCompileRef.current) {
        scheduleAutoCompile();
      }
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error));
    }
  }

  async function undoSuggestion(message: ChatMessage) {
    const suggestion = message.suggestion;
    if (!suggestion) return;
    if (suggestion.status !== "applied") {
      updateChat(
        (messages) =>
          withSuggestionStatus(messages, message.id, { status: "dismissed" }),
        { persist: true },
      );
      flash(t("workspace.toastDismissed"));
      return;
    }
    await saveQueueRef.current?.flush();
    try {
      const result = await undoSuggestionTransaction<Project>({
        getCurrent: () => projectRef.current,
        commit: commitProject,
        suggestion,
      });
      if (!result.ok) {
        flash(result.error.message || t("assistant.undoConflict"));
        return;
      }
      if (suggestion.appliedTo) setActiveFile(suggestion.appliedTo);
      setSelection(undefined);
      updateChat(
        (messages) => withSuggestionStatus(messages, message.id, result.suggestionPatch),
        { persist: true },
      );
      setCompiled(false);
      flash(t("workspace.toastUndone"));
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error));
    }
  }

  function editSource(value: string) {
    const current = projectRef.current;
    if (!current) return;
    setSelection(undefined);
    setProjectState({
      ...current,
      updatedAt: new Date().toISOString(),
      files: { ...current.files, [activeFile]: value },
    });
    saveQueueRef.current?.schedule();
    setCompiled(false);
    scheduleAutoCompile();
  }

  async function importImage(file: File) {
    const current = projectRef.current;
    if (!current) return;
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!extension || !IMAGE_EXTENSIONS.has(extension)) {
      flash(t("files.imageTypeError"));
      return;
    }

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      flash(t("files.imageReadError"));
      return;
    }

    const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
    const stem = safeName.slice(0, Math.max(0, safeName.length - extension.length - 1)) || "image";
    const baseName = `${stem}.${extension}`;
    let imagePath = `figures/${baseName}`;
    let suffix = 2;
    while (Object.keys(current.files).some((path) => path.toLowerCase() === imagePath.toLowerCase())) {
      const dot = baseName.lastIndexOf(".");
      imagePath = `figures/${baseName.slice(0, dot)}-${suffix}${baseName.slice(dot)}`;
      suffix += 1;
    }

    const latest = projectRef.current;
    if (!latest || latest.id !== current.id) return;
    const next: Project = {
      ...latest,
      updatedAt: new Date().toISOString(),
      files: { ...latest.files, [imagePath]: encodeBinaryBytes(bytes) },
      fileOrder: [...(latest.fileOrder ?? Object.keys(latest.files)), imagePath].filter(
        (path, index, paths) => paths.indexOf(path) === index,
      ),
    };
    setProjectState(next);
    saveQueueRef.current?.schedule();
    setCompiled(false);
    flash(t("files.imageUploaded"));
  }

  function addImage() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf";
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void importImage(file);
    };
    input.click();
  }

  function onWorkspaceDragEnter(event: DragEvent<HTMLElement>) {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    imageDragDepthRef.current += 1;
    setImageDragActive(true);
  }

  function onWorkspaceDragLeave(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    imageDragDepthRef.current = Math.max(0, imageDragDepthRef.current - 1);
    if (imageDragDepthRef.current === 0) setImageDragActive(false);
  }

  function onWorkspaceDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    imageDragDepthRef.current = 0;
    setImageDragActive(false);
    const file = Array.from(event.dataTransfer.files).find((candidate) => {
      const extension = candidate.name.split(".").pop()?.toLowerCase();
      return Boolean(extension && IMAGE_EXTENSIONS.has(extension));
    });
    if (!file) {
      flash(t("files.imageTypeError"));
      return;
    }
    void importImage(file);
  }

  function exportProject() {
    const current = projectRef.current;
    if (!current) return;
    try {
      const safeName = current.title.replace(/[\\/:*?"<>|]+/g, "-").trim() || "medprism-project";
      downloadProjectZip(current.files, `${safeName}.zip`);
      flash(t("workspace.toastExported"));
    } catch (error) {
      flash(`导出失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function fixWithAi() {
    setAiOpen(true);
    void send(demo ? t("assistant.demo.q4") : t("assistant.q4"), "compile-fix");
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
        autoCompile={autoCompile}
        onToggleAssistant={() => setAiOpen((value) => !value)}
        onExport={exportProject}
        onCompile={() => void compile()}
        onCancelCompile={cancelCompile}
        onToggleAutoCompile={toggleAutoCompile}
        onProjectClick={() => navigate("/projects")}
        onApiSettings={() => setProviderOpen(true)}
      />
      <main
        className={`workspace${imageDragActive ? " is-image-dragging" : ""}`}
        onDragEnter={onWorkspaceDragEnter}
        onDragOver={(event) => {
          if (Array.from(event.dataTransfer.types).includes("Files")) event.preventDefault();
        }}
        onDragLeave={onWorkspaceDragLeave}
        onDrop={onWorkspaceDrop}
        style={{
          gridTemplateColumns: `${filesWidth}px 5px minmax(0, 1fr) 5px ${previewWidth}px`,
        }}
      >
        {imageDragActive && (
          <div className="image-drop-indicator" aria-hidden>
            {t("files.dropImage")}
          </div>
        )}
        <FileTree
          files={fileEntries}
          activeFileId={activeFile}
          onSelect={(path) => {
            setActiveFile(path);
            setSelection(undefined);
            setRevealedSelection(undefined);
            setCursor(0);
            const content = projectRef.current?.files[path];
            const bytes = content ? decodeBinaryFile(content) : null;
            if (bytes && path.toLowerCase().endsWith(".pdf")) {
              setPdfFromBytes(bytes);
              setCompiled(true);
              setCompileFailed(false);
            }
          }}
          onAddImage={addImage}
          accountLabel={
            auth.status === "authenticated"
              ? auth.displayName || auth.contact || t("common.guest")
              : t("common.signIn")
          }
          onAccountClick={() => {
            setAuth(loadAuth());
            navigate(auth.status === "authenticated" ? "/projects" : "/login?mode=login");
          }}
          onApiSettings={() => setProviderOpen(true)}
        />
        <ResizeHandle
          label={t("resize.files")}
          onResize={(delta) =>
            setFilesWidth((width) => Math.min(FILES_MAX, Math.max(FILES_MIN, width + delta)))
          }
        />
        <section className="panel panel-center">
          <div className="source-stack">
            <SourcePane
              fileName={activeFile}
              value={source}
              onChange={editSource}
              onSelectionChange={(next) => {
                setSelection(next);
                setRevealedSelection(undefined);
              }}
              onCursorChange={setCursor}
              revealSelection={revealedSelection}
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
                onStop={() => {
                  if (stopProjectAssistant(project.id, t("assistant.stopped"))) {
                    setSending(false);
                  }
                }}
                quickPrompts={quickPrompts}
                onKeep={(message) => void keepSuggestion(message)}
                onUndo={(message) => void undoSuggestion(message)}
                sending={sending}
                memoryNotes={memoryNotes}
                onMemoryNotesChange={(notes) => {
                  setMemoryNotes(notes);
                  if (project.id) saveProjectMemory(project.id, notes);
                }}
              />
            )}
          </div>
        </section>
        <ResizeHandle
          label={t("resize.preview")}
          invert
          onResize={(delta) =>
            setPreviewWidth((width) =>
              Math.min(PREVIEW_MAX, Math.max(PREVIEW_MIN, width + delta)),
            )
          }
        />
        <PreviewPane
          compiling={compiling}
          compiled={compiled}
          onCompile={() => void compile()}
          onFixWithAi={fixWithAi}
          title={preview.title}
          authors={preview.authors}
          pdfUrl={pdfUrl}
          compileFailed={compileFailed}
          onPdfTextSelection={revealPdfSelection}
        />
      </main>
      <ProviderSettingsModal open={providerOpen} onClose={() => setProviderOpen(false)} />
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
