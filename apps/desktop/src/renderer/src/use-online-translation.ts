import { useEffect, useRef, useState } from 'react';
import type {
  OnlineSubtitleSource,
  OnlineTranslationSnapshot,
} from '../../shared/online-translation';
import type { TargetLanguage } from '../../shared/translation';

export function useOnlineTranslation(source: OnlineSubtitleSource | null, positionSeconds: number) {
  const [snapshot, setSnapshot] = useState<OnlineTranslationSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [language, setLanguage] = useState<TargetLanguage>('zh-CN');
  const generation = useRef(0);
  const position = useRef(0);
  position.current = Math.max(0, Math.round(positionSeconds * 1000));
  const running = snapshot?.state === 'translating' || snapshot?.state === 'ready';

  useEffect(() => {
    generation.current++;
    setSnapshot(null);
    setError('');
    setBusy(false);
    return () => {
      generation.current++;
      if (source)
        void window.cueweave.onlineTranslation({ action: 'stop', sourceId: source.sourceId });
    };
  }, [source?.sourceId]);

  useEffect(() => {
    if (!source || !running) return;
    let active = true;
    let pending = false;
    const current = generation.current;
    const poll = async () => {
      if (pending) return;
      pending = true;
      try {
        const result = await window.cueweave.onlineTranslation({
          action: 'tick',
          sourceId: source.sourceId,
          positionMs: position.current,
        });
        if (!active || current !== generation.current) return;
        if (result.ok) setSnapshot(result.value);
        else {
          setError(result.error.message);
          setSnapshot((s) => (s ? { ...s, state: 'failed' } : s));
        }
      } finally {
        pending = false;
      }
    };
    const timer = window.setInterval(() => void poll(), 700);
    void poll();
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [source?.sourceId, running]);

  async function toggle() {
    if (!source || busy) return;
    const current = ++generation.current;
    setBusy(true);
    setError('');
    const result = await window.cueweave.onlineTranslation(
      running
        ? { action: 'stop', sourceId: source.sourceId }
        : {
            action: 'start',
            sourceId: source.sourceId,
            targetLanguage: language,
            positionMs: position.current,
          },
    );
    if (current !== generation.current) return;
    setBusy(false);
    if (result.ok) setSnapshot(result.value);
    else setError(result.error.message);
  }
  function changeLanguage(value: TargetLanguage) {
    setLanguage(value);
    setSnapshot(null);
    setError('');
  }
  return { snapshot, busy, error, language, setLanguage: changeLanguage, toggle, running };
}
