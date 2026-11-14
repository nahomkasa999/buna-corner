import crypto from "crypto";

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
}

export interface ValidationResult {
  valid: boolean;
  user?: TelegramUser;
  authDate?: number;
  error?: string;
}

/**
 * Validate Telegram Mini App initData per https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 * secret = SHA256(botToken); data-check-string = sorted `key=<value>` lines
 * (excluding `hash`); HMAC-SHA256 hex must match `hash`.
 */
export function validateInitData(
  initData: string,
  botToken: string,
  opts: { maxAgeSeconds?: number; now?: number } = {},
): ValidationResult {
  if (!initData) return { valid: false, error: "initData missing" };
  if (!botToken) return { valid: false, error: "BOT_TOKEN not configured" };
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { valid: false, error: "hash missing" };
  const pairs: string[] = [];
  params.forEach((value, key) => {
    if (key !== "hash") pairs.push(`${key}=${value}`);
  });
  pairs.sort();
  const dataCheckString = pairs.join("\n");
  const secret = crypto.createHash("sha256").update(botToken).digest();
  const computed = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
  const a = Buffer.from(computed, "utf8");
  const b = Buffer.from(hash.toLowerCase(), "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { valid: false, error: "hash mismatch" };
  }
  const authDate = Number(params.get("auth_date") ?? 0);
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const maxAge = opts.maxAgeSeconds ?? 24 * 3600;
  if (!authDate || now - authDate > maxAge) {
    return { valid: false, error: "auth_date expired" };
  }
  const rawUser = params.get("user");
  if (!rawUser) return { valid: false, error: "user missing" };
  try {
    const user = JSON.parse(rawUser) as TelegramUser;
    return { valid: true, user, authDate };
  } catch {
    return { valid: false, error: "user JSON invalid" };
  }
}

/** Test helper: forge a valid initData for a given user + token (tests only). */
export function forgeInitData(user: TelegramUser, botToken: string, authDate?: number): string {
  const params = new URLSearchParams();
  params.set("user", JSON.stringify(user));
  params.set("auth_date", String(authDate ?? Math.floor(Date.now() / 1000)));
  const pairs: string[] = [];
  params.forEach((value, key) => pairs.push(`${key}=${value}`));
  pairs.sort();
  const secret = crypto.createHash("sha256").update(botToken).digest();
  const hash = crypto.createHmac("sha256", secret).update(pairs.join("\n")).digest("hex");
  params.set("hash", hash);
  return params.toString();
}

export const DEMO_USER: TelegramUser = {
  id: 999999, first_name: "Demo", username: "demo_guest", language_code: "en",
};

export function isOwner(userId: number | string | undefined | null): boolean {
  const owner = process.env.OWNER_TELEGRAM_ID;
  return !!owner && String(userId) === String(owner);
}

/** Resolve the acting user from a request: valid initData wins, else demo headers, else DEMO_USER. */
export function resolveUser(req: Request, bodyInitData?: string | null): { user: TelegramUser; validated: boolean; demo: boolean } {
  const headerInit = req.headers.get("x-telegram-init-data");
  const initData = headerInit || bodyInitData || "";
  const token = process.env.BOT_TOKEN || "";
  if (initData && token) {
    const r = validateInitData(initData, token);
    if (r.valid && r.user) return { user: r.user, validated: true, demo: false };
  }
  const demoId = req.headers.get("x-demo-user");
  if (demoId) {
    const id = Number(demoId);
    return { user: { ...DEMO_USER, id: Number.isFinite(id) ? id : DEMO_USER.id }, validated: false, demo: true };
  }
  return { user: DEMO_USER, validated: false, demo: true };
}

export function isOwnerRequest(req: Request, user: TelegramUser): boolean {
  if (isOwner(user.id)) return true;
  if (req.headers.get("x-demo-owner") === "1") return true;
  try {
    const url = new URL(req.url);
    if (url.searchParams.get("demoOwner") === "1") return true;
  } catch { /* ignore */ }
  return false;
}
