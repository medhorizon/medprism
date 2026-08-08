import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { LangSwitch } from "../components/LangSwitch";
import { ProviderSettingsModal } from "../components/ProviderSettingsModal";
import { useI18n } from "../i18n/context";
import type { MessageKey } from "../i18n/types";
import { loadAuth, signOut, type AuthState } from "../state/auth";
import { hasCustomLlmConfig } from "../state/llm";
import {
  createProjectFromBundledTemplate,
  deleteProject,
  ensureDemoProject,
  loadProjects,
  migrateLocalProjects,
  renameProject,
  type Project,
} from "../state/projects";
import { listOfficialTemplates, type OfficialTemplateSpec } from "../templates";

const PROVIDER_PROMPT_KEY = "medprism.provider.prompted";

function formatUpdated(iso: string, locale: string) {
  try {
    return new Date(iso).toLocaleString(locale === "zh" ? "zh-CN" : "en");
  } catch {
    return iso;
  }
}

function tplKey(id: string, part: "name" | "desc"): MessageKey {
  return `tpl.${id}.${part}` as MessageKey;
}

export function ProjectsPage() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const templates = useMemo(() => listOfficialTemplates(), []);
  const [auth, setAuth] = useState<AuthState>(() => loadAuth());
  const [projects, setProjects] = useState<Project[]>(() => {
    migrateLocalProjects();
    ensureDemoProject();
    return loadProjects();
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<OfficialTemplateSpec>(templates[0]);
  const [title, setTitle] = useState(() => t("templates.untitled"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<Project | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [providerOpen, setProviderOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);

  useEffect(() => {
    if (auth.status !== "guest") return;
    const setup = searchParams.get("setup");
    if (setup === "api") {
      setProviderOpen(true);
      sessionStorage.setItem(PROVIDER_PROMPT_KEY, "1");
      const next = new URLSearchParams(searchParams);
      next.delete("setup");
      setSearchParams(next, { replace: true });
      return;
    }
    if (!hasCustomLlmConfig() && !sessionStorage.getItem(PROVIDER_PROMPT_KEY)) {
      sessionStorage.setItem(PROVIDER_PROMPT_KEY, "1");
      setProviderOpen(true);
    }
  }, [auth.status, searchParams, setSearchParams]);

  function refresh() {
    setProjects(loadProjects());
  }

  function openPicker() {
    setError(null);
    setBusy(false);
    setTitle(t("templates.untitled"));
    setPickerOpen(true);
  }

  function closePicker() {
    setPickerOpen(false);
    setError(null);
    setBusy(false);
  }

  async function handleCreate() {
    setBusy(true);
    setError(null);
    try {
      const project = await createProjectFromBundledTemplate({
        title,
        templateId: selectedTemplate.id,
      });
      if (!project) {
        setError(t("templates.failCreate"));
        return;
      }
      refresh();
      closePicker();
      navigate(`/p/${project.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("templates.failLoad"));
    } finally {
      setBusy(false);
    }
  }

  function openRename(p: Project) {
    setRenameTarget(p);
    setRenameValue(p.title);
  }

  function saveRename() {
    if (!renameTarget) return;
    renameProject(renameTarget.id, renameValue);
    setRenameTarget(null);
    refresh();
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    deleteProject(deleteTarget.id);
    ensureDemoProject();
    setDeleteTarget(null);
    refresh();
  }

  function confirmSignOut() {
    setAuth(signOut());
    setSignOutOpen(false);
  }

  const statusText =
    auth.status === "authenticated"
      ? t("projects.statusSignedIn", { name: auth.displayName || auth.contact || "" })
      : t("projects.statusGuest");

  return (
    <div className="shell-page">
      <div className="shell-card shell-card-wide">
        <div className="shell-row">
          <div className="brand shell-brand">
            <div className="brand-mark">M</div>
            <div className="brand-name">MedPrism</div>
          </div>
          <LangSwitch />
        </div>
        <div className="shell-row">
          <h1 className="shell-title">{t("projects.title")}</h1>
          <div className="shell-row-actions">
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => setProviderOpen(true)}
            >
              {t("projects.apiSettings")}
            </button>
            {auth.status === "authenticated" ? (
              <button
                className="btn btn-primary"
                type="button"
                title={t("common.signOut")}
                onClick={() => setSignOutOpen(true)}
              >
                {auth.displayName || auth.contact || t("common.guest")}
              </button>
            ) : (
              <>
                <Link className="btn btn-secondary" to="/login?mode=login">
                  {t("common.signIn")}
                </Link>
                <Link className="btn btn-primary" to="/login?mode=register">
                  {t("common.register")}
                </Link>
              </>
            )}
          </div>
        </div>
        <p className="shell-copy">{t("projects.copy")}</p>
        <p className="shell-status">{statusText}</p>
        {auth.status === "authenticated" && (
          <p className="shell-status">{t("projects.hostedApiHint")}</p>
        )}

        <div className="project-list">
          {projects.map((p) => (
            <div key={p.id} className="project-row project-row-static">
              <Link className="project-row-main" to={`/p/${p.id}`}>
                <div className="project-row-title">{p.title}</div>
                <div className="project-row-meta">
                  {p.templateName ?? p.templateId} · {t("projects.updated")}{" "}
                  {formatUpdated(p.updatedAt, locale)}
                </div>
              </Link>
              <div className="project-row-actions">
                <Link className="btn btn-ghost" to={`/p/${p.id}`}>
                  {t("common.open")}
                </Link>
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => openRename(p)}
                >
                  {t("common.rename")}
                </button>
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => setDeleteTarget(p)}
                >
                  {t("common.delete")}
                </button>
              </div>
            </div>
          ))}
        </div>

        <button className="btn btn-primary" type="button" onClick={openPicker}>
          {t("projects.new")}
        </button>
      </div>

      <ProviderSettingsModal open={providerOpen} onClose={() => setProviderOpen(false)} />

      {pickerOpen && (
        <div className="modal-backdrop" role="presentation" onClick={closePicker}>
          <div
            className="modal-card"
            role="dialog"
            aria-label={t("templates.title")}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shell-row">
              <h2 className="shell-title" style={{ fontSize: 18 }}>
                {t("templates.title")}
              </h2>
              <button className="btn btn-ghost" type="button" onClick={closePicker}>
                {t("common.close")}
              </button>
            </div>
            <p className="shell-copy">{t("templates.copy")}</p>

            <label className="field-label" htmlFor="project-title">
              {t("templates.projectTitle")}
            </label>
            <input
              id="project-title"
              className="field-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />

            <div className="template-grid">
              {templates.map((tmpl) => (
                <button
                  key={tmpl.id}
                  type="button"
                  className={`template-card ${selectedTemplate.id === tmpl.id ? "active" : ""}`}
                  onClick={() => {
                    setSelectedTemplate(tmpl);
                    setError(null);
                  }}
                >
                  <div className="template-card-publisher">{tmpl.publisher}</div>
                  <div className="template-card-name">{t(tplKey(tmpl.id, "name"))}</div>
                  <div className="template-card-desc">{t(tplKey(tmpl.id, "desc"))}</div>
                  <div className="template-card-tags">
                    {tmpl.tags.slice(0, 3).map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                </button>
              ))}
            </div>

            <div className="template-note">
              <strong>{t(tplKey(selectedTemplate.id, "name"))}</strong> —{" "}
              {selectedTemplate.zipHint}
              <div className="template-note-actions">
                <a
                  className="btn btn-ghost"
                  href={selectedTemplate.downloadPage}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("templates.sourcePage")}
                </a>
              </div>
              <div className="template-license">{selectedTemplate.licenseNote}</div>
            </div>

            {error && <p className="template-error">{error}</p>}

            <button
              className="btn btn-primary"
              type="button"
              onClick={handleCreate}
              disabled={busy}
            >
              {busy ? t("templates.creating") : t("templates.create")}
            </button>
          </div>
        </div>
      )}

      {renameTarget && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setRenameTarget(null)}
        >
          <div
            className="modal-card modal-card-sm"
            role="dialog"
            aria-label={t("projects.renameTitle")}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="shell-title" style={{ fontSize: 18 }}>
              {t("projects.renameTitle")}
            </h2>
            <label className="field-label" htmlFor="rename-title">
              {t("projects.renameLabel")}
            </label>
            <input
              id="rename-title"
              className="field-input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveRename();
              }}
              autoFocus
            />
            <div className="modal-actions">
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => setRenameTarget(null)}
              >
                {t("common.cancel")}
              </button>
              <button className="btn btn-primary" type="button" onClick={saveRename}>
                {t("common.save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className="modal-card modal-card-sm"
            role="dialog"
            aria-label={t("projects.deleteTitle")}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="shell-title" style={{ fontSize: 18 }}>
              {t("projects.deleteTitle")}
            </h2>
            <p className="shell-copy">
              {t("projects.deleteCopy", { title: deleteTarget.title })}
            </p>
            <div className="modal-actions">
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => setDeleteTarget(null)}
              >
                {t("common.cancel")}
              </button>
              <button className="btn btn-primary" type="button" onClick={confirmDelete}>
                {t("projects.deleteConfirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      {signOutOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setSignOutOpen(false)}
        >
          <div
            className="modal-card modal-card-sm"
            role="dialog"
            aria-label={t("common.signOutTitle")}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="shell-title" style={{ fontSize: 18 }}>
              {t("common.signOutTitle")}
            </h2>
            <p className="shell-copy">{t("common.signOutCopy")}</p>
            <div className="modal-actions">
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => setSignOutOpen(false)}
              >
                {t("common.cancel")}
              </button>
              <button className="btn btn-primary" type="button" onClick={confirmSignOut}>
                {t("common.signOutConfirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
