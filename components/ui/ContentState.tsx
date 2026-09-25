import type { ReactNode } from 'react';
import { StudyIcon } from '@/components/dashboard/StudyUI';
import styles from './content-state.module.css';

export function LoadingState({ label = '載入中…' }: { label?: string }) {
  return <div className={styles.loading} role="status" aria-busy="true"><p>{label}</p><div aria-hidden="true" className={styles.skeleton}><span /><span /><span /></div></div>;
}

export function EmptyState({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return <div className={styles.empty}><span aria-hidden="true"><StudyIcon name="folder" /></span><h2>{title}</h2>{description && <p>{description}</p>}{children && <div className={styles.actions}>{children}</div>}</div>;
}
