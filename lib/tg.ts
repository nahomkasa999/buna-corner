// Tiny raw Telegram Bot API helper shared by widgets, checkout and the agent.
// grammY does not know Bot API 10.4 methods (sendWidget, ...) yet, and the
// payment/agent code needs to run outside a grammY ctx, so these are plain
// fetch() calls. Never throws; a missing BOT_TOKEN yields {ok:false}.

export type TgResult = { ok: boolean; result?: unknown; reason?: string };

export async function tgCall(method: string, params: Record<string, unknown>): Promise<TgResult> {
  const token = process.env.BOT_TOKEN;
  if (!token) return { ok: false, reason: "BOT_TOKEN not configured" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: unknown; description?: string };
    if (!data.ok) return fail(method, data.description || `Telegram ${method} failed`);
    return { ok: true, result: data.result };
  } catch (e) {
    return fail(method, e instanceof Error ? e.message : "network error");
  }
}

/** Every failed call is logged (Vercel → Logs) — silent failures hid the widget bug. */
function fail(method: string, reason: string): TgResult {
  if (process.env.NODE_ENV !== "test" && !process.env.TG_QUIET) console.error(`[telegram] ${method} failed: ${reason}`);
  return { ok: false, reason };
}

/** Multipart upload (voice notes etc.). */
export async function tgUpload(
  method: string,
  fields: Record<string, string | number>,
  file: { field: string; data: Buffer; filename: string; mime: string },
): Promise<TgResult> {
  const token = process.env.BOT_TOKEN;
  if (!token) return { ok: false, reason: "BOT_TOKEN not configured" };
  try {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
    fd.append(file.field, new Blob([new Uint8Array(file.data)], { type: file.mime }), file.filename);
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", body: fd });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: unknown; description?: string };
    if (!data.ok) return fail(method, data.description || `Telegram ${method} failed`);
    return { ok: true, result: data.result };
  } catch (e) {
    return fail(method, e instanceof Error ? e.message : "network error");
  }
}

export function sendPhoto(chatId: number, photoUrl: string, caption: string): Promise<TgResult> {
  return tgCall("sendPhoto", { chat_id: chatId, photo: photoUrl, caption });
}

export function deleteMessage(chatId: number, messageId: number): Promise<TgResult> {
  return tgCall("deleteMessage", { chat_id: chatId, message_id: messageId });
}

/** Send an MP3 as a voice note (Telegram accepts OGG/Opus, MP3 or M4A for sendVoice). */
export function sendVoiceMp3(chatId: number, mp3: Buffer, caption?: string): Promise<TgResult> {
  return tgUpload(
    "sendVoice",
    { chat_id: chatId, ...(caption ? { caption: caption.slice(0, 1024) } : {}) },
    { field: "voice", data: mp3, filename: "buna.mp3", mime: "audio/mpeg" },
  );
}

export function botUsername(): string {
  return process.env.BOT_USERNAME || process.env.NEXT_PUBLIC_BOT_USERNAME || "Alerter_nazbot";
}

/** t.me link to the Mini App (Main Mini App direct link). */
export function shopUrl(startapp?: string): string {
  const base = `https://t.me/${botUsername()}/shop`;
  return startapp ? `${base}?startapp=${encodeURIComponent(startapp)}` : base;
}

/**
 * One-button inline keyboard that opens the Mini App ("see more details").
 * web_app button when NEXT_PUBLIC_APP_URL is set, else a t.me url button.
 */
export function miniAppKeyboard(label: string, query = ""): { inline_keyboard: unknown[][] } {
  const app = process.env.NEXT_PUBLIC_APP_URL || "";
  return {
    inline_keyboard: [[app ? { text: label, web_app: { url: `${app}${query}` } } : { text: label, url: shopUrl() }]],
  };
}

/** Send a plain text message (no keyboard unless given). */
export function sendText(chatId: number, text: string, replyMarkup?: unknown): Promise<TgResult> {
  return tgCall("sendMessage", { chat_id: chatId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) });
}
