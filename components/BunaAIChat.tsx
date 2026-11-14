"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface ChatMsg { role: "user" | "ai"; text: string; }

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: number;
  userName: string;
  api: (path: string, opts?: RequestInit) => Promise<Record<string, unknown>>;
  haptic: (kind?: "light" | "medium" | "heavy" | "success") => void;
}

function playAudioData(base64: string, mime: string): HTMLAudioElement | null {
  try {
    const audio = new Audio(`data:${mime};base64,${base64}`);
    void audio.play().catch(() => undefined);
    return audio;
  } catch { return null; }
}

/**
 * Buna AI — floating chat button + bottom-sheet panel.
 * Amharic-first, EN/አማ toggle, optional voice replies (plays the TTS
 * audio the API returns). Voice autoplay needs a user tap first on
 * iOS/Telegram, so the toggle only auto-plays after the user has spoken.
 */
export default function BunaAIChat({ open, onOpenChange, userId, userName, api, haptic }: Props) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [lang, setLang] = useState<"am" | "en">("am");
  const [voiceReplies, setVoiceReplies] = useState(false);
  const [playing, setPlaying] = useState<number | null>(null);
  const greeted = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing, open]);

  // First open: the AI greets by name (Amharic default).
  useEffect(() => {
    if (!open || greeted.current) return;
    greeted.current = true;
    setTyping(true);
    api("/api/ai/chat", {
      method: "POST",
      body: JSON.stringify({ greet: true, userId, userName, lang, voice: voiceReplies }),
    }).then((d) => {
      setTyping(false);
      if (d.ok && typeof d.reply === "string") {
        const reply: string = d.reply;
        setMessages([{ role: "ai", text: reply }]);
        if (voiceReplies && typeof d.audioBase64 === "string") {
          audioRef.current?.pause();
          audioRef.current = playAudioData(d.audioBase64, (d.audioMime as string) || "audio/wav");
        }
      }
    }).catch(() => setTyping(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const playVoice = useCallback(async (text: string, idx: number) => {
    audioRef.current?.pause();
    setPlaying(idx);
    try {
      const d = await api("/api/ai/speak", { method: "POST", body: JSON.stringify({ text, lang }) });
      if (typeof d.audioBase64 === "string" && d.audioBase64) {
        audioRef.current = playAudioData(d.audioBase64, (d.audioMime as string) || "audio/wav");
        audioRef.current?.addEventListener("ended", () => setPlaying(null), { once: true });
      } else {
        setPlaying(null);
      }
    } catch { setPlaying(null); }
  }, [api, lang]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || typing) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);
    setTyping(true);
    haptic("light");
    try {
      const d = await api("/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({ message: text, userId, userName, lang, voice: voiceReplies }),
      });
      setTyping(false);
      if (d.ok && typeof d.reply === "string") {
        const reply: string = d.reply;
        setMessages((m) => [...m, { role: "ai", text: reply }]);
        if (voiceReplies && typeof d.audioBase64 === "string" && d.audioBase64) {
          audioRef.current?.pause();
          audioRef.current = playAudioData(d.audioBase64, (d.audioMime as string) || "audio/wav");
        }
      } else {
        setMessages((m) => [...m, { role: "ai", text: lang === "am" ? "ይቅርታ፣ አሁን መልስ መስጠት አልቻልኩም። እንደገና ይሞክሩ።" : "Sorry, I couldn't answer right now. Please try again." }]);
      }
    } catch {
      setTyping(false);
      setMessages((m) => [...m, { role: "ai", text: lang === "am" ? "ይቅርታ፣ ግንኙነቱ ተቋርጧል። እንደገና ይሞክሩ።" : "Sorry, the connection dropped. Please try again." }]);
    }
  }, [input, typing, api, userId, userName, lang, voiceReplies, haptic]);

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => { onOpenChange(!open); haptic("light"); }}
        aria-label="Chat with Buna AI"
        className="fixed bottom-20 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-coffee-900 text-2xl text-white shadow-card active:scale-95"
        style={{ bottom: "calc(5rem + env(safe-area-inset-bottom))" }}
      >
        {open ? "✕" : "💬"}
      </button>

      {/* Bottom-sheet chat panel */}
      {open && (
        <div className="fixed inset-x-0 bottom-0 z-40 mx-auto flex max-h-[75vh] w-full max-w-md flex-col rounded-t-3xl bg-white shadow-card" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
          <div className="flex items-center gap-3 border-b border-coffee-100 px-4 py-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-coffee-900 text-xl">🤖</span>
            <div className="flex-1">
              <p className="text-sm font-black">Buna AI • ቡና AI</p>
              <p className="text-[11px] text-coffee-500">{lang === "am" ? "የእርስዎ ባሪስታ — ያስታውሰዎታል" : "Your barista — she remembers you"}</p>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setLang("am")} className={`rounded-full px-2.5 py-1 text-xs font-bold ${lang === "am" ? "bg-coffee-900 text-white" : "bg-coffee-100"}`}>አማ</button>
              <button onClick={() => setLang("en")} className={`rounded-full px-2.5 py-1 text-xs font-bold ${lang === "en" ? "bg-coffee-900 text-white" : "bg-coffee-100"}`}>EN</button>
            </div>
            <button onClick={() => onOpenChange(false)} className="px-1 text-lg text-coffee-400">✕</button>
          </div>

          <div className="flex items-center gap-2 border-b border-coffee-100 px-4 py-2">
            <button
              onClick={() => setVoiceReplies((v) => !v)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ${voiceReplies ? "bg-coffee-900 text-white" : "bg-coffee-100 text-coffee-700"}`}
            >
              🔊 {voiceReplies ? (lang === "am" ? "የድምፅ መልስ: በርቷል" : "Voice replies: on") : (lang === "am" ? "የድምፅ መልስ: ጠፍቷል" : "Voice replies: off")}
            </button>
            <p className="text-[11px] text-coffee-400">{lang === "am" ? "አማርኛ ወይም እንግሊዝኛ ይጻፉ" : "Write in Amharic or English"}</p>
            <p className="text-[11px] text-coffee-400">💬 {lang === "am" ? "በቦት ቻት ውስጥ ስለ አንድ ምግብ/መጠጥ ስጠይቁ ካርዱን እልክልዎታለሁ" : "Ask the bot about an item and I'll send its card in the chat"}</p>
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
            {messages.length === 0 && !typing && (
              <p className="rounded-2xl bg-coffee-50 p-3 text-sm text-coffee-600">
                {lang === "am" ? "ሰላም! ስለ ቡና፣ ሻይ ወይም ምናሌው ማንኛውንም ነገር ጠይቀኝ።" : "Hello! Ask me anything about the coffee, tea or menu."}
              </p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-3xl px-3.5 py-2.5 text-sm leading-relaxed ${m.role === "user" ? "bg-coffee-900 text-white" : "bg-coffee-100 text-coffee-800"}`}>
                  <p>{m.text}</p>
                  {m.role === "ai" && (
                    <button onClick={() => void playVoice(m.text, i)} className="mt-1.5 flex items-center gap-1 rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-bold text-coffee-700 active:scale-95">
                      {playing === i ? "🔊 Playing…" : "🔊 Listen"}
                    </button>
                  )}
                </div>
              </div>
            ))}
            {typing && (
              <div className="flex justify-start">
                <div className="rounded-3xl bg-coffee-100 px-4 py-3 text-sm text-coffee-500">Buna AI is thinking…</div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="flex gap-2 border-t border-coffee-100 p-3">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void send(); }}
              placeholder={lang === "am" ? "ለቡና AI ይጻፉ…" : "Message Buna AI…"}
              className="min-w-0 flex-1 rounded-full border border-coffee-100 bg-coffee-50 px-4 py-2.5 text-sm outline-none focus:border-coffee-400"
            />
            <button onClick={() => void send()} disabled={!input.trim() || typing} className="shrink-0 rounded-full bg-coffee-900 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40 active:scale-95">➤</button>
          </div>
        </div>
      )}
    </>
  );
}
