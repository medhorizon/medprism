import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { LangSwitch } from "../components/LangSwitch";
import { useI18n } from "../i18n/context";
import { isAuthStubMode, requestCode } from "../lib/authApi";
import {
  continueAsGuest,
  hasRefreshToken,
  signInWithCode,
  signInWithEmail,
  signInWithRefresh,
} from "../state/auth";

const CODE_COOLDOWN_SEC = 60;

export function LoginPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const mode = searchParams.get("mode") === "register" ? "register" : "login";

  const [contact, setContact] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [canQuickLogin, setCanQuickLogin] = useState(() => hasRefreshToken());

  useEffect(() => {
    setError(null);
    setHint(null);
    setCode("");
  }, [mode]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setInterval(() => {
      setCooldown((n) => (n <= 1 ? 0 : n - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [cooldown]);

  function goProjects(query?: string) {
    navigate(query ? `/projects?${query}` : "/projects", { replace: true });
  }

  async function handleQuickLogin() {
    setError(null);
    setBusy(true);
    try {
      const result = await signInWithRefresh();
      if (!result.ok) {
        setCanQuickLogin(false);
        setError(
          result.error === "invalid_refresh"
            ? t("login.refreshInvalid")
            : t("login.networkError"),
        );
        return;
      }
      goProjects();
    } finally {
      setBusy(false);
    }
  }

  async function handleSendCode() {
    setError(null);
    setHint(null);
    if (!contact.trim()) {
      setError(t("login.contactRequired"));
      return;
    }
    if (cooldown > 0 || sendingCode) return;
    setSendingCode(true);
    try {
      const result = await requestCode(contact);
      if (!result.ok) {
        if (result.error === "rate_limited") {
          setError(t("login.rateLimited"));
        } else if (result.error === "invalid_contact") {
          setError(t("login.contactRequired"));
        } else {
          setError(t("login.networkError"));
        }
        return;
      }
      if (result.stubHint) {
        setHint(t("login.codeSentStub", { code: result.stubHint }));
      } else {
        setHint(t("login.codeSentReal"));
      }
      setCooldown(CODE_COOLDOWN_SEC);
    } finally {
      setSendingCode(false);
    }
  }

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!contact.trim()) {
      setError(t("login.contactRequired"));
      return;
    }
    setBusy(true);
    try {
      const result = await signInWithEmail(contact);
      if (!result.ok) {
        setError(
          result.error === "not_registered"
            ? t("login.notRegistered")
            : result.error === "invalid_contact"
              ? t("login.contactRequired")
              : t("login.networkError"),
        );
        return;
      }
      setCanQuickLogin(true);
      goProjects();
    } finally {
      setBusy(false);
    }
  }

  async function handleRegister(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!contact.trim()) {
      setError(t("login.contactRequired"));
      return;
    }
    if (!code.trim()) {
      setError(t("login.codeRequired"));
      return;
    }
    setBusy(true);
    try {
      const result = await signInWithCode({ contact, code });
      if (!result.ok) {
        setError(
          result.error === "invalid_code"
            ? t("login.codeInvalid")
            : result.error === "invalid_contact"
              ? t("login.contactRequired")
              : result.error === "network"
                ? t("login.networkError")
                : t("login.verifyFailed"),
        );
        return;
      }
      setCanQuickLogin(true);
      goProjects();
    } finally {
      setBusy(false);
    }
  }

  function handleGuest() {
    continueAsGuest();
    goProjects();
  }

  return (
    <div className="shell-page">
      <div className="shell-card">
        <div className="shell-row">
          <div className="brand shell-brand">
            <div className="brand-mark">M</div>
            <div className="brand-name">MedPrism</div>
          </div>
          <LangSwitch />
        </div>
        <h1 className="shell-title">
          {mode === "register" ? t("login.registerTitle") : t("login.title")}
        </h1>
        <p className="shell-copy">
          {mode === "register" ? t("login.registerCopy") : t("login.copy")}
        </p>
        {isAuthStubMode() && (
          <p className="shell-status">{t("login.stubModeHint")}</p>
        )}

        {mode === "login" && canQuickLogin && (
          <div className="shell-actions" style={{ marginBottom: 8 }}>
            <button
              className="btn btn-primary"
              type="button"
              disabled={busy}
              onClick={handleQuickLogin}
            >
              {t("login.quickSignIn")}
            </button>
            <p className="shell-status">{t("login.quickSignInHint")}</p>
          </div>
        )}

        {mode === "login" ? (
          <form className="shell-actions" onSubmit={handleLogin}>
            <label className="field-label" htmlFor="login-contact">
              {t("login.contact")}
            </label>
            <input
              id="login-contact"
              className="field-input"
              type="email"
              autoComplete="email"
              placeholder={t("login.contactPlaceholder")}
              value={contact}
              onChange={(e) => {
                setContact(e.target.value);
                setError(null);
              }}
            />
            {error && <p className="template-error">{error}</p>}
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {t("common.signIn")}
            </button>
            <Link className="btn btn-secondary" to="/login?mode=register">
              {t("common.register")}
            </Link>
            <button className="btn btn-ghost" type="button" onClick={handleGuest}>
              {t("login.continueGuest")}
            </button>
          </form>
        ) : (
          <form className="shell-actions" onSubmit={handleRegister}>
            <label className="field-label" htmlFor="login-contact">
              {t("login.contact")}
            </label>
            <input
              id="login-contact"
              className="field-input"
              type="email"
              autoComplete="email"
              placeholder={t("login.contactPlaceholder")}
              value={contact}
              onChange={(e) => {
                setContact(e.target.value);
                setError(null);
              }}
            />

            <label className="field-label" htmlFor="login-code">
              {t("login.code")}
            </label>
            <div className="field-row">
              <input
                id="login-code"
                className="field-input field-input-grow"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder={t("login.codePlaceholder")}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  setError(null);
                }}
              />
              <button
                className="btn btn-secondary"
                type="button"
                disabled={cooldown > 0 || sendingCode}
                onClick={handleSendCode}
              >
                {cooldown > 0
                  ? t("login.sendCodeWait", { n: cooldown })
                  : t("login.sendCode")}
              </button>
            </div>

            {hint && <p className="shell-status">{hint}</p>}
            {error && <p className="template-error">{error}</p>}

            <button className="btn btn-primary" type="submit" disabled={busy}>
              {t("common.register")}
            </button>
            <Link className="btn btn-secondary" to="/login?mode=login">
              {t("common.signIn")}
            </Link>
            <button className="btn btn-ghost" type="button" onClick={handleGuest}>
              {t("login.continueGuest")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
