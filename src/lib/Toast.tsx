import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Info } from 'lucide-react';

interface ToastCtx {
  notify: (message: string) => void;
}

const Ctx = createContext<ToastCtx>({ notify: () => {} });

interface Item {
  id: number;
  message: string;
  leaving: boolean;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const seq = useRef(0);

  const notify = useCallback((message: string) => {
    const id = ++seq.current;
    setItems((list) => [...list.slice(-2), { id, message, leaving: false }]);
    window.setTimeout(() => {
      setItems((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    }, 2600);
    window.setTimeout(() => {
      setItems((list) => list.filter((t) => t.id !== id));
    }, 2900);
  }, []);

  return (
    <Ctx.Provider value={{ notify }}>
      {children}
      <div className="toast-wrap" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast${t.leaving ? ' toast--leaving' : ''}`}>
            <Info size={17} aria-hidden="true" />
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
