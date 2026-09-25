import type { ReactNode } from 'react';
import styles from './foundation.module.css';

/** Shared by analysis, study plan and review; keeps each page's content and actions. */
export default function PageHeader({ title, description, eyebrow, children }: {
  title: string;
  description?: string;
  eyebrow?: string;
  children?: ReactNode;
}) {
  return <header className={styles.header}>
    <div>{eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}<h1>{title}</h1>{description && <p className={styles.description}>{description}</p>}</div>
    {children}
  </header>;
}
