"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, ShieldAlert, ArrowRightLeft, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { JOURNAL_STORAGE_KEY, readJournal, type JournalEntry, type NotificationDraft } from "@/lib/notification-journal";
import { minutesLabel } from "@/lib/vrptw";

export function useNotificationJournal() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { const saved = readJournal(window.localStorage.getItem(JOURNAL_STORAGE_KEY)); setEntries(current => [...new Map([...saved, ...current].map(entry => [entry.id, entry])).values()]); } catch { setStorageError(true); }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try { window.localStorage.setItem(JOURNAL_STORAGE_KEY, JSON.stringify(entries)); }
    catch { /* The journal stays available for this open page when browser storage is full or disabled. */
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStorageError(true);
    }
  }, [entries, loaded]);
  const append = useCallback((drafts: NotificationDraft[]) => {
    if (!drafts.length) return;
    const recordedAt = new Date().toISOString();
    const added = drafts.map(draft => ({ ...draft, id: crypto.randomUUID(), recordedAt }));
    setEntries(current => [...current, ...added]);
  }, []);
  return { entries, append, storageError };
}

export function NotificationJournal({ entries, open, onOpenChange, storageError }: { entries: JournalEntry[]; open: boolean; onOpenChange: (open: boolean) => void; storageError: boolean }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="notification-dialog"><DialogHeader><DialogTitle>Журнал уведомлений</DialogTitle><DialogDescription>Время события — время рабочей смены. История сохраняется в этом браузере, даже если уведомление скрыто.</DialogDescription></DialogHeader>
    {storageError && <p role="status" className="journal-storage-warning">Браузер не разрешил сохранить историю. Записи доступны до закрытия страницы.</p>}
    <div className="notification-history">{entries.length ? [...entries].reverse().map(entry => <article key={entry.id} className={`journal-entry journal-${entry.kind}`}>
      <span className="journal-icon" aria-hidden="true">{entry.kind === "emergency" || entry.kind === "left" ? <ShieldAlert /> : entry.kind === "reassigned" ? <ArrowRightLeft /> : entry.kind === "cancelled" ? <X /> : <Bell />}</span>
      <div><div className="journal-entry-heading"><strong>{entry.title}</strong><b>{minutesLabel(entry.time)}</b></div><p>{entry.message}</p><small>Записано {new Date(entry.recordedAt).toLocaleString("ru-RU")}</small></div>
    </article>) : <p className="journal-empty">Пока событий нет. Здесь появятся отмены заявок, выходы из смены, ЧС и переназначения.</p>}</div>
  </DialogContent></Dialog>;
}
