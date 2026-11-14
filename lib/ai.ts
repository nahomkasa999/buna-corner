// Buna AI — Amharic-first AI barista for Buna Corner.
//
// Uses Google Gemini (@google/genai) for chat + TTS. Runs in graceful MOCK
// mode when GEMINI_API_KEY is unset or equals the placeholder TEST_KEY_1:
// canned Amharic replies (stock-aware), no audio, no network calls, never
// a crash. NEVER put a real key in this file, in tests, or in any fixture.
//
// Memory is LangChain-style per-user memory implemented by hand in
// lib/store.ts (history + prefs per Telegram user id). LangChain swap point:
// chatWithMemory() is the single seam — replace its Gemini call with a
// LangChain chain (@langchain/google-genai ChatGoogleGenerativeAI +
// BufferMemory / a Postgres-backed chat history) and keep the same
// {reply, lang} return shape; the API routes, bot and frontend need no change.

import { GoogleGenAI } from "@google/genai";
import { MENU_ITEMS } from "./data";
import {
  appendTurn,
  getMenuItem,
  getOrCreateUserMemory,
  getStock,
  setUserLang,
  stockLeft,
  type UserMemory,
} from "./store";

export type AiLang = "am" | "en";

const CHAT_MODEL = "gemini-3-flash-preview";
const CHAT_FALLBACK_MODEL = "gemini-3.5-flash-lite";
const TTS_MODEL = "gemini-2.5-flash-preview-tts";
const TTS_VOICE = "Kore";

// NOTE (Nov 14 2026): gemini-2.5-flash / 2.0-flash return 404 for new API keys
// ("no longer available to new users"). Chat + TTS only work on the v1beta
// API with gemini-3-flash-preview (fallback gemini-3.5-flash-lite); the TTS
// model works on v1beta too. Do not switch back to v1 / 2.x models.

const PLACEHOLDER_KEY = "TEST_KEY_1";

export function aiConfigured(): boolean {
  const key = process.env.GEMINI_API_KEY;
  return !!key && key !== PLACEHOLDER_KEY;
}

function getClient(): GoogleGenAI | null {
  if (!aiConfigured()) return null;
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY as string,
    httpOptions: { apiVersion: "v1beta" },
  });
}

/** Amharic if the text has Ethiopic script or common Amharic words, else English. */
export function detectLang(text: string): AiLang {
  if (/[\u1200-\u137C]/.test(text)) return "am";
  const lower = text.toLowerCase();
  const amWords = ["selam", "salam", "endemen", "indemen", "buna", "macchiato", "shai", "betam", "ameseginalehu", "amesegnalehu", "dehna", "yih", "min", "ale", "esh", "ewo", "abet"];
  if (amWords.some((w) => lower.includes(w))) return "am";
  return "en";
}

function menuContext(): string {
  return MENU_ITEMS.filter((m) => !m.hidden)
    .map((m) => `- ${m.name} (${m.amharicName}) — ${m.price} ETB, ${m.category}: ${m.description}`)
    .join("\n");
}

/** Compact live stock snapshot so the AI answers stock questions truthfully. */
function stockContext(): string {
  return MENU_ITEMS.filter((m) => !m.hidden)
    .map((m) => {
      const left = stockLeft(m.id);
      return `- ${m.name}: ${left <= 0 ? "SOLD OUT" : `${left} left`}`;
    })
    .join("\n");
}

function systemPrompt(mem: UserMemory): string {
  const favNames = mem.prefs.favourites
    .map((id) => getMenuItem(id)?.name)
    .filter(Boolean)
    .slice(0, 3);
  return `You are Buna AI, the warm, friendly barista of Buna Corner, a coffee shop in Addis Ababa (Bole). You speak Amharic by default; if the customer writes in English, reply in English. Keep chat replies short — 2-4 sentences. Be warm and a little playful, like a favourite neighbourhood barista.

Your goals: greet warmly, answer questions about the menu, recommend items, upsell gently (a larger size, a food pairing, a bag of beans to take home), and help the customer order. Never invent items or prices that are not on the menu below. Never sell an item that is sold out — if the customer asks for one, say so kindly and suggest an in-stock alternative from the same category.

MENU:
${menuContext()}

LIVE STOCK (right now):
${stockContext()}

CUSTOMER:
- Name: ${mem.name}
- Past orders: ${mem.prefs.orderCount}
- Favourites: ${favNames.length ? favNames.join(", ") : "none yet"}
- Last order: ${mem.prefs.lastOrderId ?? "none"}

Sizes add +30 ETB (Medium) / +60 ETB (Large); oat or almond milk +20 ETB. Delivery is 50 ETB, pickup is free. Every 8th coffee is free (stamp card). Beans of the Month is 900 ETB/month.`;
}

// ---------- Mock mode (no key): canned, stock-aware replies ----------

export function findMentionedItem(text: string) {
  const lower = text.toLowerCase();
  return MENU_ITEMS.find(
    (m) =>
      lower.includes(m.name.toLowerCase()) ||
      (m.amharicName && text.includes(m.amharicName)) ||
      lower.includes(m.slug.replace(/-/g, " ")) ||
      lower.includes(m.id.replace(/-/g, " ")),
  );
}

function inStockPopular(limit = 2) {
  return MENU_ITEMS.filter((m) => m.popular && !m.hidden && stockLeft(m.id) > 0).slice(0, limit);
}

function mockReply(message: string, lang: AiLang): string {
  const mentioned = findMentionedItem(message);
  if (mentioned) {
    const left = stockLeft(mentioned.id);
    if (left <= 0) {
      const alt = MENU_ITEMS.find(
        (m) => m.category === mentioned.category && m.id !== mentioned.id && stockLeft(m.id) > 0,
      ) ?? inStockPopular(1)[0];
      if (lang === "am") {
        return `ይቅርታ! ${mentioned.name} ዛሬ አልቋል።${alt ? ` በምትኩ ${alt.name} (${alt.price} ብር) ልሞክርልዎት? በጣም ጣፋጭ ነው።` : ""} እባክዎ ሌላ ይምረጡ።`;
      }
      return `Sorry — ${mentioned.name} is sold out today.${alt ? ` How about ${alt.name} (${alt.price} ETB) instead? It's lovely.` : ""}`;
    }
    if (lang === "am") {
      return `${mentioned.name} አለን! ${mentioned.price} ብር ነው — ${mentioned.description} እፈልጋለሁ ብለው ከሆነ ከምናሌው ይምረጡ ወይም “አዝዝ” ይበሉ።`;
    }
    return `Yes, we have ${mentioned.name} — ${mentioned.price} ETB. ${mentioned.description} Tap the menu to add it, or say "order it" and I'll set it up for you.`;
  }
  const picks = inStockPopular(2);
  const pickText = picks.map((p) => `${p.name} (${p.price} ብር)`).join(" እና ");
  if (lang === "am") {
    return `ሰላም! እንኳን ደህና መጡ ወደ ቡና ኮርነር ☕ ዛሬ ምን ልጠጣልዎት? ተወዳጁ ${pickText} አለን። መጠጥ ይፈልጋሉ ወይስ ስለ ምናሌው ልነግርዎት?`;
  }
  const pickEn = picks.map((p) => `${p.name} (${p.price} ETB)`).join(" and ");
  return `Hello, welcome to Buna Corner ☕ What can I get you today? Our favourites ${pickEn} are ready. Want a drink, or shall I tell you about the menu?`;
}

function mockGreeting(name: string, lang: AiLang): string {
  const picks = inStockPopular(2);
  const pickText = picks.map((p) => `${p.name} (${p.price} ብር)`).join(" እና ");
  if (lang === "am") {
    return `ሰላም ${name}! እንኳን ደህና መጡ ወደ ቡና ኮርነር ☕ ዛሬ ${pickText} አለን። ምን ልጠጣልዎት? መጠጥ ስለመረጡ ልነግርዎት እችላለሁ።`;
  }
  const pickEn = picks.map((p) => `${p.name} (${p.price} ETB)`).join(" and ");
  return `Hello ${name}, welcome to Buna Corner ☕ Today we have ${pickEn}. What shall I get you? I can recommend something or tell you about the menu.`;
}

// ---------- Live Gemini helpers ----------

async function geminiChat(prompt: string, mem: UserMemory, model: string): Promise<string> {
  const ai = getClient();
  if (!ai) throw new Error("AI not configured");
  const contents = [
    ...mem.history.map((t) => ({
      role: t.role === "ai" ? ("model" as const) : ("user" as const),
      parts: [{ text: t.text }],
    })),
    { role: "user" as const, parts: [{ text: prompt }] },
  ];
  const res = await ai.models.generateContent({
    model,
    contents,
    config: { systemInstruction: systemPrompt(mem), maxOutputTokens: 350, temperature: 0.8 },
  });
  const text = res.text?.trim();
  if (!text) throw new Error("Empty Gemini reply");
  return text;
}

// ---------- Public API ----------

export interface ChatResult { reply: string; lang: AiLang; mock: boolean; memoryTurns: number; }

export async function chatWithMemory(
  userId: number,
  userName: string,
  message: string,
  langHint?: string,
): Promise<ChatResult> {
  const mem = getOrCreateUserMemory(userId, userName);
  const lang: AiLang = langHint === "en" || langHint === "am" ? langHint : detectLang(message);
  setUserLang(userId, lang);
  appendTurn(userId, "user", message);

  if (!aiConfigured()) {
    const reply = mockReply(message, lang);
    appendTurn(userId, "ai", reply);
    return { reply, lang, mock: true, memoryTurns: getOrCreateUserMemory(userId).history.length };
  }
  try {
    const reply = await geminiChat(message, mem, CHAT_MODEL);
    appendTurn(userId, "ai", reply);
    return { reply, lang, mock: false, memoryTurns: getOrCreateUserMemory(userId).history.length };
  } catch {
    // Live call failed (model unavailable, quota, network) — try the fallback model once.
    try {
      const reply = await geminiChat(message, mem, CHAT_FALLBACK_MODEL);
      appendTurn(userId, "ai", reply);
      return { reply, lang, mock: false, memoryTurns: getOrCreateUserMemory(userId).history.length };
    } catch {
      const reply = mockReply(message, lang);
      appendTurn(userId, "ai", reply);
      return { reply, lang, mock: true, memoryTurns: getOrCreateUserMemory(userId).history.length };
    }
  }
}

export async function greetUser(
  userId: number,
  userName: string,
  langHint?: string,
): Promise<ChatResult> {
  const mem = getOrCreateUserMemory(userId, userName);
  const lang: AiLang = langHint === "en" || langHint === "am" ? langHint : mem.prefs.lang;
  setUserLang(userId, lang);
  if (!aiConfigured()) {
    const reply = mockGreeting(userName, lang);
    appendTurn(userId, "ai", reply);
    return { reply, lang, mock: true, memoryTurns: getOrCreateUserMemory(userId).history.length };
  }
  try {
    const reply = await geminiChat(
      lang === "am"
        ? "The customer just opened the shop. Greet them warmly by name in Amharic, mention 2 popular in-stock items, and ask what they'd like."
        : "The customer just opened the shop. Greet them warmly by name in English, mention 2 popular in-stock items, and ask what they'd like.",
      mem,
      CHAT_MODEL,
    );
    appendTurn(userId, "ai", reply);
    return { reply, lang, mock: false, memoryTurns: getOrCreateUserMemory(userId).history.length };
  } catch {
    const reply = mockGreeting(userName, lang);
    appendTurn(userId, "ai", reply);
    return { reply, lang, mock: true, memoryTurns: getOrCreateUserMemory(userId).history.length };
  }
}

export interface SpeakResult { audioBase64: string | null; mimeType: string | null; reason?: string; }

/** Gemini TTS. Mock mode (or any error) returns audioBase64 null — chat never fails. */
export async function speakText(text: string, lang: AiLang): Promise<SpeakResult> {
  if (!aiConfigured()) return { audioBase64: null, mimeType: null, reason: "mock" };
  try {
    const ai = getClient();
    if (!ai) return { audioBase64: null, mimeType: null, reason: "mock" };
    const res = await ai.models.generateContent({
      model: TTS_MODEL,
      contents: [{ role: "user", parts: [{ text: `Say in ${lang === "am" ? "Amharic" : "English"}: ${text}` }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: TTS_VOICE } },
          languageCode: lang === "am" ? "am-ET" : "en-US",
        },
      },
    });
    const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!part?.inlineData?.data) return { audioBase64: null, mimeType: null, reason: "no-audio" };
    return { audioBase64: part.inlineData.data, mimeType: part.inlineData.mimeType ?? "audio/wav" };
  } catch {
    return { audioBase64: null, mimeType: null, reason: "tts-error" };
  }
}

export interface DescribeResult { text: string; item?: { id: string; name: string; price: number }; audioBase64: string | null; audioMime: string | null; mock: boolean; }

/** Short vivid spoken-style description of an item + TTS audio for it. */
export async function describeItem(itemId: string, langHint?: string): Promise<DescribeResult> {
  const item = getMenuItem(itemId);
  const lang: AiLang = langHint === "en" || langHint === "am" ? langHint : "am";
  if (!item) return { text: lang === "am" ? "ይቅርታ፣ ይህን ንጥል አላገኘሁም።" : "Sorry, I couldn't find that item.", audioBase64: null, audioMime: null, mock: !aiConfigured() };
  const left = stockLeft(item.id);
  const stockNote = left <= 0
    ? lang === "am" ? " ግን ዛሬ አልቋል።" : " — but it is sold out today."
    : "";

  if (!aiConfigured()) {
    const text = lang === "am"
      ? `${item.name} — ${item.amharicName}። ${item.description} ዋጋው ${item.price} ብር ነው።${stockNote}`
      : `${item.name} — ${item.description} It costs ${item.price} ETB.${stockNote}`;
    return { text, item: { id: item.id, name: item.name, price: item.price }, audioBase64: null, audioMime: null, mock: true };
  }
  try {
    const ai = getClient();
    if (!ai) throw new Error("AI not configured");
    const prompt = lang === "am"
      ? `Describe this coffee-shop item in 2-3 vivid, spoken-style Amharic sentences, as a warm barista speaking to a customer. Item: ${item.name} (${item.amharicName}), ${item.price} ETB. ${item.description}${left <= 0 ? " It is sold out today — say so kindly." : ""}`
      : `Describe this coffee-shop item in 2-3 vivid, spoken-style English sentences, as a warm barista speaking to a customer. Item: ${item.name}, ${item.price} ETB. ${item.description}${left <= 0 ? " It is sold out today — say so kindly." : ""}`;
  // Try the main model, then the fallback — preview models 503 under load.
  let text: string | null = null;
  for (const model of [CHAT_MODEL, CHAT_FALLBACK_MODEL]) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { maxOutputTokens: 250, temperature: 0.8 },
      });
      text = res.text?.trim() || null;
      if (text) break;
    } catch {
      // try the next model
    }
  }
  if (!text) throw new Error("Gemini describe failed on both models");
  const audio = await speakText(text, lang);
    return { text, item: { id: item.id, name: item.name, price: item.price }, audioBase64: audio.audioBase64, audioMime: audio.mimeType, mock: false };
  } catch {
    const text = lang === "am"
      ? `${item.name} — ${item.amharicName}። ${item.description} ዋጋው ${item.price} ብር ነው።${stockNote}`
      : `${item.name} — ${item.description} It costs ${item.price} ETB.${stockNote}`;
    return { text, item: { id: item.id, name: item.name, price: item.price }, audioBase64: null, audioMime: null, mock: true };
  }
}
