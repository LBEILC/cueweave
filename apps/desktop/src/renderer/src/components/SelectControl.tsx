import { CaretDownIcon } from '@phosphor-icons/react';
import type { SelectHTMLAttributes } from 'react';

export function SelectControl(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="select-control">
      <select
        {...props}
        onKeyDownCapture={(event) => {
          // The page also uses Escape; an open picker owns this keystroke first.
          if (event.key === 'Escape' && event.currentTarget.matches(':open'))
            event.stopPropagation();
          props.onKeyDownCapture?.(event);
        }}
      />
      <CaretDownIcon size={14} aria-hidden="true" />
    </span>
  );
}
