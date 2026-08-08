import { useI18n } from "../i18n/context";
import type { Locale } from "../i18n/types";

export function LangSwitch() {
  const { locale, setLocale, t } = useI18n();

  return (
    <label className="lang-switch" title={t("lang.switch")}>
      <span className="lang-switch-label">{t("lang.switch")}</span>
      <select
        className="lang-switch-select"
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
        aria-label={t("lang.switch")}
      >
        <option value="zh">{t("lang.zh")}</option>
        <option value="en">{t("lang.en")}</option>
      </select>
    </label>
  );
}
