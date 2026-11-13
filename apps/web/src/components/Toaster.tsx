import { useEffect, useState } from 'react';
import Icon, { type IconName } from './Icon';

/**
 * Small confirmations for actions that otherwise finish silently (export started, settings applied,
 * a version restored). Call toast() from anywhere; <Toaster /> is mounted once in App.
 * Timers pause while the tab is hidden so a message is never missed.
 */
interface Toast { id: number; text: string; icon: IconName; leaving: boolean }

let seq = 0;
const listeners = new Set<(t: Toast) => void>();

export function toast(text: string, icon: IconName = 'check') {
  const t: Toast = { id: ++seq, text, icon, leaving: false };
  listeners.forEach((l) => l(t));
}

const SHOW_MS = 3200;
const LEAVE_MS = 160;

export default function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);

  useEffect(() => {
    const add = (t: Toast) => setItems((xs) => [...xs.slice(-2), t]);
    listeners.add(add);
    return () => { listeners.delete(add); };
  }, []);

  useEffect(() => {
    const live = items.filter((t) => !t.leaving);
    if (!live.length) return;
    let timer = 0;
    const arm = () => {
      window.clearTimeout(timer);
      if (document.hidden) return;
      timer = window.setTimeout(() => {
        const first = live[0]!;
        setItems((xs) => xs.map((x) => (x.id === first.id ? { ...x, leaving: true } : x)));
        window.setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== first.id)), LEAVE_MS);
      }, SHOW_MS);
    };
    arm();
    document.addEventListener('visibilitychange', arm);
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', arm); };
  }, [items]);

  return (
    <ol className="toaster" aria-live="polite" aria-label="Notifications">
      {items.map((t) => (
        <li key={t.id} className={`toast${t.leaving ? ' leaving' : ''}`}>
          <Icon name={t.icon} size={16} />
          <span>{t.text}</span>
        </li>
      ))}
    </ol>
  );
}
