"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createWorkspaceWriter, loadWorkspace, writeWorkspace } from "@/lib/workspace-storage";

export function usePersistentWorkspace<T>(snapshot: T, restore: (value:T) => void, savingAllowed: boolean) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const restoreRef = useRef(restore);
  const snapshotRef = useRef(snapshot);
  const allowedRef = useRef(savingAllowed);
  const writer = useRef(createWorkspaceWriter<T>(writeWorkspace));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { restoreRef.current = restore; snapshotRef.current = snapshot; allowedRef.current = savingAllowed; }, [restore, snapshot, savingAllowed]);
  useEffect(() => {
    let alive = true;
    void loadWorkspace<T>().then(value => { if (alive && value) restoreRef.current(value); }).catch(() => { if (alive) setError("Не удалось открыть хранилище браузера. Изменения могут не сохраниться после перезагрузки."); }).finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!ready || !savingAllowed) return;
    // Throttle rather than debounce: a continuously moving clock must also save.
    if (timerRef.current !== null) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (allowedRef.current) void writer.current(snapshotRef.current).catch(() => setError("Не удалось сохранить сценарий. Проверьте свободное место и разрешение браузера на хранение данных."));
    }, 200);
  }, [snapshot, ready, savingAllowed]);
  useEffect(() => () => { if (timerRef.current !== null) clearTimeout(timerRef.current); }, []);
  useEffect(() => {
    if (!ready) return;
    const flush = () => { if (allowedRef.current) void writer.current(snapshotRef.current).catch(() => {}); };
    window.addEventListener("pagehide", flush);
    const visibility = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", visibility);
    return () => { window.removeEventListener("pagehide",flush); document.removeEventListener("visibilitychange",visibility); };
  }, [ready]);
  const saveNow=useCallback((value:T) => {
    if (timerRef.current !== null) { clearTimeout(timerRef.current); timerRef.current=null; }
    snapshotRef.current=value;
    return writer.current(value).catch(()=>setError("Не удалось сохранить сценарий в браузере."));
  }, []);
  return { ready, error, saveNow };
}
