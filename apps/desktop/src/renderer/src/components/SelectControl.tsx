import { CaretDownIcon } from '@phosphor-icons/react';
import type { SelectHTMLAttributes } from 'react';

export function SelectControl(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="select-control">
      <select {...props} />
      <CaretDownIcon size={14} aria-hidden="true" />
    </span>
  );
}
