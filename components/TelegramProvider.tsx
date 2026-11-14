"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { TelegramUser } from "@/lib/telegram-auth";

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        initDataUnsafe?: { user?: TelegramUser; start_param?: string; query_id?: string };
        colorScheme?: string;
        themeParams?: Record<string, string>;
        expand: () => void;
        ready: () => void;
        requestFullscreen?: () => void;
        setHeaderColor: (c: string) => void;
        setBackgroundColor: (c: string) => void;
        HapticFeedback?: { impactOccurred: (s: string) => void; notificationOccurred: (t: string) => void; selectionChanged: () => void };
        MainButton: { text: string; show: () => void; hide: () => void; setText: (t: string) => void; onClick: (fn: () => void) => void; offClick: (fn: () => void) => void; enable: () => void; disable: () => void };
        BackButton: { show: () => void; hide: () => void; onClick: (fn: () => void) => void; offClick: (fn: () => void) => void };
        openTelegramLink?: (url: string) => void;
        shareToChat?: (url: string) => void;
        requestLocation?: (cb: (loc: { latitude: number; longitude: number } | null) => void) => void;
        sendData?: (data: string) => void;
        close?: () => void;
      };
    };
  }
}

interface TelegramCtx {
  user: TelegramUser | null;
  initData: string;
  isTelegram: boolean;
  startParam: string | null;
  haptic: (kind?: "light" | "medium" | "heavy" | "success") => void;
  setMainButton: (label: string | null, onClick?: () => void) => void;
  setBackButton: (visible: boolean, onClick?: () => void) => void;
}

const Ctx = createContext<TelegramCtx>({
  user: null, initData: "", isTelegram: false, startParam: null,
  haptic: () => undefined, setMainButton: () => undefined, setBackButton: () => undefined,
});

export const useTelegram = () => useContext(Ctx);

export function TelegramProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<TelegramUser | null>(null);
  const [initData, setInitData] = useState("");
  const [isTelegram, setIsTelegram] = useState(false);
  const [startParam, setStartParam] = useState<string | null>(null);
  const mainCb = useRef<(() => void) | null>(null);
  const backCb = useRef<(() => void) | null>(null);

  useEffect(() => {
    const wa = window.Telegram?.WebApp;
    if (wa) {
      setIsTelegram(true);
      try {
        wa.ready();
        wa.expand();
        wa.requestFullscreen?.();
        wa.setHeaderColor?.("#1A120B");
        wa.setBackgroundColor?.("#FFF8F0");
      } catch { /* demo-safe */ }
      setInitData(wa.initData || "");
      if (wa.initDataUnsafe?.user) setUser(wa.initDataUnsafe.user);
      const sp = wa.initDataUnsafe?.start_param
        || new URLSearchParams(window.location.search).get("tgWebAppStartParam")
        || new URLSearchParams(window.location.search).get("startapp");
      if (sp) setStartParam(sp);
      const tp = wa.themeParams || {};
      const root = document.documentElement;
      if (tp.bg_color) root.style.setProperty("--tg-bg", tp.bg_color);
      if (tp.text_color) root.style.setProperty("--tg-text", tp.text_color);
      if (tp.button_color) root.style.setProperty("--tg-accent", tp.button_color);
      if (tp.accent_text_color) root.style.setProperty("--tg-accent", tp.accent_text_color);
    } else {
      const sp = new URLSearchParams(window.location.search).get("startapp");
      if (sp) setStartParam(sp);
    }
    // Best-effort @telegram-apps/sdk init (falls back to WebApp above).
    import("@telegram-apps/sdk").then((sdk) => {
      try {
        const s = sdk as unknown as Record<string, ((...a: unknown[]) => unknown) | undefined>;
        s.init?.(); s.expand?.();
        const miniApp = (sdk as unknown as { miniApp?: { mount?: () => void; setHeaderColor?: (c: string) => void; setBackgroundColor?: (c: string) => void } }).miniApp;
        miniApp?.mount?.();
        miniApp?.setHeaderColor?.("#1A120B");
      } catch { /* WebApp fallback already applied */ }
    }).catch(() => undefined);
  }, []);

  const haptic = useCallback((kind: "light" | "medium" | "heavy" | "success" = "light") => {
    try {
      const hf = window.Telegram?.WebApp?.HapticFeedback;
      if (kind === "success") hf?.notificationOccurred("success");
      else hf?.impactOccurred(kind);
    } catch { /* ignore */ }
  }, []);

  const setMainButton = useCallback((label: string | null, onClick?: () => void) => {
    const mb = window.Telegram?.WebApp?.MainButton;
    if (!mb) return;
    try {
      if (mainCb.current) mb.offClick(mainCb.current);
      if (!label) { mb.hide(); mainCb.current = null; return; }
      mainCb.current = onClick ?? null;
      mb.setText(label);
      if (onClick) mb.onClick(onClick);
      mb.show();
    } catch { /* ignore */ }
  }, []);

  const setBackButton = useCallback((visible: boolean, onClick?: () => void) => {
    const bb = window.Telegram?.WebApp?.BackButton;
    if (!bb) return;
    try {
      if (backCb.current) bb.offClick(backCb.current);
      if (!visible) { bb.hide(); backCb.current = null; return; }
      backCb.current = onClick ?? null;
      if (onClick) bb.onClick(onClick);
      bb.show();
    } catch { /* ignore */ }
  }, []);

  const value = useMemo<TelegramCtx>(() => ({
    user, initData, isTelegram, startParam, haptic, setMainButton, setBackButton,
  }), [user, initData, isTelegram, startParam, haptic, setMainButton, setBackButton]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
