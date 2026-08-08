import { env } from "./env.mjs";

function logConsoleMail({ email, code }) {
  console.log("");
  console.log("======== MedPrism OTP (console mail) ========");
  console.log(`To: ${email}`);
  console.log(`Code: ${code}`);
  console.log(`Valid for ${env.codeTtlSec}s`);
  console.log("=============================================");
  console.log("");
}

function mailBody(code) {
  const minutes = Math.max(1, Math.round(env.codeTtlSec / 60));
  return [
    "Your MedPrism verification code:",
    "",
    `  ${code}`,
    "",
    `It expires in ${minutes} minutes.`,
    "",
    "If you did not request this, you can ignore this email.",
    "",
    "— MedPrism",
  ].join("\n");
}

async function sendViaResend({ email, code }) {
  if (!env.resendApiKey) {
    throw new Error("RESEND_API_KEY is required when MAIL_MODE=resend");
  }
  if (!env.mailFrom) {
    throw new Error("MAIL_FROM is required when MAIL_MODE=resend");
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.mailFrom,
      to: [email],
      subject: "MedPrism verification code",
      text: mailBody(code),
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Resend API ${res.status}: ${text.slice(0, 400)}`);
  }

  console.log(`[mail] resend ok → ${email}`);
  if (env.mailDebug) {
    console.log(`[mail:debug] code for ${email}: ${code}`);
  }
}

/** Phase A: console. Phase B: resend (smtp reserved). */
export async function sendVerificationCode({ email, code }) {
  const mode = (env.mailMode || "console").toLowerCase();

  if (mode === "console") {
    logConsoleMail({ email, code });
    return;
  }

  if (mode === "resend") {
    await sendViaResend({ email, code });
    return;
  }

  throw new Error(
    `MAIL_MODE=${env.mailMode} is not implemented yet. Use console or resend.`,
  );
}
