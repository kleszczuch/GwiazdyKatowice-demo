import type { KeyboardEvent } from 'react';

// Esc zamyka okno (gdy wolno), a Tab krąży po jego kontrolkach.
export function modalKeys(
  event: KeyboardEvent<HTMLElement>,
  close: (() => void) | null,
) {
  if (event.key === 'Escape' && close) {
    event.stopPropagation();
    close();
  }
  if (event.key !== 'Tab') return;
  const controls = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled)',
    ),
  );
  const first = controls[0],
    last = controls.at(-1);
  if (
    event.shiftKey &&
    (document.activeElement === first ||
      document.activeElement === event.currentTarget)
  ) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
