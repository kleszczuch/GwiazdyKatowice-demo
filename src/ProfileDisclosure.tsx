import type { ReactNode } from 'react';
import './profile-disclosure.css';

export default function ProfileDisclosure({
  title,
  children,
  className = '',
}: {
  title: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details
      className={`panel profile-disclosure ${className}`}
      onInvalidCapture={(event) => {
        let parent = (event.target as HTMLElement).closest('details');
        while (parent) {
          parent.open = true;
          parent = parent.parentElement?.closest('details') ?? null;
        }
      }}
    >
      <summary>
        <span className="profile-disclosure__title">{title}</span>
      </summary>
      <div className="profile-disclosure__content">{children}</div>
    </details>
  );
}
