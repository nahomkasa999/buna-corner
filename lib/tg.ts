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
    if (!data.ok) return { ok: false, reason: data.description || `Telegram ${method} failed` };
    return { ok: true, result: data.result };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "network error" };
  }
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
