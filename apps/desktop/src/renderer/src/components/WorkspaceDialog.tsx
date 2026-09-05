import { XIcon } from '@phosphor-icons/react';
import { useEffect, useRef, type ReactNode } from 'react';

/** A modal layer keeps the media element mounted and owns its own scrolling. */
export function WorkspaceDialog({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog?.showModal();
    const frame = requestAnimationFrame(() =>
      dialog?.querySelector<HTMLElement>('h1[tabindex="-1"]')?.focus(),
    );
    return () => {
      cancelAnimationFrame(frame);
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="workspace-dialog"
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-bar">
        <span>{label}</span>
        <button type="button" className="quiet-button" aria-label="返回工作台" onClick={onClose}>
          <XIcon size={20} aria-hidden="true" />
        </button>
      </div>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}
