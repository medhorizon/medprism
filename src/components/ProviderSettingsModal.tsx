import { useEffect, useState, type FormEvent } from "react";
import { useI18n } from "../i18n/context";
import type { LlmConfig } from "../lib/llmClient";
import { loadAuth } from "../state/auth";
import { loadLlmConfig, saveLlmConfig } from "../state/llm";

type ProviderSettingsModalProps = {
  open: boolean;
  onClose: () => void;
  onSaved?: (config: LlmConfig) => void;
};

const MASK = "••••••••••••";

export function ProviderSettingsModal({
  open,
  onClose,
  onSaved,
}: ProviderSettingsModalProps) {
  const { t } = useI18n();
  const [signedIn, setSignedIn] = useState(false);
  const [usingCustomOverride, setUsingCustomOverride] = useState(false);
  const [providerName, setProviderName] = useState("custom");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("deepseek-v4-flash");
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const auth = loadAuth();
    const existing = loadLlmConfig();
    const isSignedIn = auth.status === "authenticated";
    const custom = existing.mode === "custom";
    setSignedIn(isSignedIn);
    setUsingCustomOverride(custom);
    setShowKey(false);
    setError(null);

    if (custom) {
      // User-entered override may be shown (they set it themselves).
      setProviderName(existing.providerName);
      setBaseUrl(existing.baseUrl);
      setApiKey(existing.apiKey);
      setModel(existing.model);
      return;
    }

    if (isSignedIn) {
      // Hosted credentials must never be shown in plaintext.
      setProviderName("hosted");
      setBaseUrl("");
      setApiKey("");
      setModel(auth.hosted.model || "deepseek-v4-flash");
      return;
    }

    setProviderName("custom");
    setBaseUrl("");
    setApiKey("");
    setModel("deepseek-v4-flash");
  }, [open]);

  if (!open) return null;

  const showHostedHidden = signedIn && !usingCustomOverride;

  function handleSave(e: FormEvent) {
    e.preventDefault();
    const name = providerName.trim() || "custom";
    const url = baseUrl.trim();
    const key = apiKey.trim();
    const m = model.trim();

    if (showHostedHidden) {
      // Saving while hosted is active requires a full custom override.
      if (!url || !key || !m) {
        setError(t("provider.overrideRequired"));
        return;
      }
    } else if (!url || !key || !m) {
      setError(t("provider.required"));
      return;
    }

    const config: LlmConfig = {
      mode: "custom",
      providerName: name === "hosted" ? "custom" : name,
      baseUrl: url,
      apiKey: key,
      model: m,
      api: "openai-completions",
    };
    saveLlmConfig(config);
    onSaved?.(config);
    onClose();
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card modal-card-sm"
        role="dialog"
        aria-label={t("provider.title")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shell-row">
          <h2 className="shell-title" style={{ fontSize: 18 }}>
            {t("provider.title")}
          </h2>
          <button className="btn btn-ghost" type="button" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
        <p className="shell-copy">{t("provider.copy")}</p>
        {showHostedHidden && (
          <p className="shell-status">{t("provider.hostedHidden")}</p>
        )}
        {signedIn && usingCustomOverride && (
          <p className="shell-status">{t("provider.customOverrideHint")}</p>
        )}

        <form className="provider-form" onSubmit={handleSave}>
          <label className="field-label" htmlFor="provider-name">
            {t("provider.name")}
          </label>
          <input
            id="provider-name"
            className="field-input"
            value={showHostedHidden ? "hosted" : providerName}
            disabled={showHostedHidden}
            placeholder={t("provider.namePlaceholder")}
            onChange={(e) => setProviderName(e.target.value)}
          />

          <label className="field-label" htmlFor="provider-base-url">
            {t("provider.baseUrl")}
          </label>
          <input
            id="provider-base-url"
            className="field-input"
            value={showHostedHidden ? MASK : baseUrl}
            readOnly={showHostedHidden}
            placeholder={
              showHostedHidden
                ? t("provider.hostedMasked")
                : t("provider.baseUrlPlaceholder")
            }
            onFocus={() => {
              if (showHostedHidden) {
                // First edit clears mask and switches to override entry.
                setUsingCustomOverride(true);
                setProviderName("custom");
                setBaseUrl("");
                setApiKey("");
              }
            }}
            onChange={(e) => {
              setBaseUrl(e.target.value);
              setError(null);
            }}
          />

          <label className="field-label" htmlFor="provider-api-key">
            {t("provider.apiKey")}
          </label>
          <div className="field-row">
            <input
              id="provider-api-key"
              className="field-input field-input-grow"
              type={showKey && !showHostedHidden ? "text" : "password"}
              value={showHostedHidden ? MASK : apiKey}
              readOnly={showHostedHidden}
              autoComplete="off"
              placeholder={
                showHostedHidden ? t("provider.hostedMasked") : undefined
              }
              onFocus={() => {
                if (showHostedHidden) {
                  setUsingCustomOverride(true);
                  setProviderName("custom");
                  setBaseUrl("");
                  setApiKey("");
                }
              }}
              onChange={(e) => {
                setApiKey(e.target.value);
                setError(null);
              }}
            />
            {!showHostedHidden && (
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => setShowKey((v) => !v)}
              >
                {showKey ? t("provider.hideKey") : t("provider.showKey")}
              </button>
            )}
          </div>
          <p className="field-hint">
            {showHostedHidden
              ? t("provider.hostedOverrideHint")
              : t("provider.apiKeyHint")}
          </p>

          <label className="field-label" htmlFor="provider-api">
            {t("provider.api")}
          </label>
          <select id="provider-api" className="field-input" value="openai-completions" disabled>
            <option value="openai-completions">openai-completions</option>
          </select>

          <label className="field-label" htmlFor="provider-model">
            {t("provider.model")}
          </label>
          <input
            id="provider-model"
            className="field-input"
            value={model}
            placeholder={t("provider.modelPlaceholder")}
            onChange={(e) => {
              setModel(e.target.value);
              setError(null);
            }}
          />

          {error && <p className="template-error">{error}</p>}

          <div className="modal-actions">
            <button className="btn btn-ghost" type="button" onClick={onClose}>
              {showHostedHidden ? t("common.close") : t("common.cancel")}
            </button>
            <button className="btn btn-primary" type="submit">
              {showHostedHidden ? t("provider.saveOverride") : t("common.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
