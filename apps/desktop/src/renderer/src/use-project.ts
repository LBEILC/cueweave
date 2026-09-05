import { useEffect, useRef, useState } from 'react';
import type { ProjectCommand, ProjectOpened, ProjectSnapshot } from '../../shared/project';

export function useProject(onOpened: (opened: ProjectOpened) => void) {
  const [project, setProject] = useState<ProjectSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const active = useRef(false);
  const refreshing = useRef(false);
  const openedRef = useRef(onOpened);
  openedRef.current = onOpened;
  const current = useRef(project);
  current.current = project;
  useEffect(() => {
    document.documentElement.dataset.projectId = project?.id ?? '';
    document.documentElement.dataset.projectDirty = String(dirty);
  }, [project?.id, dirty]);
  async function run(command: ProjectCommand): Promise<boolean> {
    if (active.current) return false;
    active.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await window.cueweave.projectCommand(command);
      if (!result.ok) {
        setError(result.error.message);
        return false;
      }
      if (!result.value) return false;
      const next = result.value.opened?.project ?? result.value.project;
      if (next) {
        setProject(next);
        current.current = next;
      }
      if (result.value.opened) openedRef.current(result.value.opened);
      setMessage(result.value.exported ? `已导出 ${result.value.exported}` : '已保存');
      return true;
    } catch {
      setError('项目操作未完成，请重试。');
      return false;
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    void run({ action: 'recent' });
  }, []);
  useEffect(() => {
    if (project?.translation?.state !== 'running') return;
    const timer = setInterval(() => {
      const p = current.current;
      if (!p || active.current || refreshing.current) return;
      refreshing.current = true;
      void window.cueweave
        .projectCommand({ action: 'refresh', projectId: p.id, baseRevision: p.revision })
        .then((result) => {
          if (
            active.current ||
            current.current?.id !== p.id ||
            current.current.revision !== p.revision
          )
            return;
          if (!result.ok) {
            setError(result.error.message);
            return;
          }
          const next = result.value?.project;
          if (next) {
            setProject(next);
            current.current = next;
          }
        })
        .finally(() => {
          refreshing.current = false;
        });
    }, 800);
    return () => clearInterval(timer);
  }, [project?.id, project?.translation?.state]);
  const checkpoint = async (positionSeconds: number) => {
    const p = current.current;
    if (!p || active.current || !Number.isFinite(positionSeconds)) return;
    active.current = true;
    try {
      const result = await window.cueweave.projectCommand({
        action: 'position',
        projectId: p.id,
        baseRevision: p.revision,
        positionMs: Math.max(0, Math.round(positionSeconds * 1000)),
      });
      if (!result.ok) setError(result.error.message);
    } finally {
      active.current = false;
    }
  };
  const detach = () => {
    setProject(null);
    current.current = null;
    setDirty(false);
    setError('');
    setMessage('');
  };
  return { project, busy, dirty, setDirty, message, error, run, checkpoint, detach };
}
