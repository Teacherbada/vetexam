import Link from 'next/link';
import type { ReactNode } from 'react';
import PageHeader from './PageHeader';
import foundation from './foundation.module.css';
import styles from './admin.module.css';

export default function AdminShell({ title, description, current, children }: { title: string; description?: string; current: string; children: ReactNode }) {
  return <main className={`${foundation.foundation} ${styles.page}`}><div className={styles.container}>
    <PageHeader title={title} description={description} eyebrow="VetExam · 管理員工具" />
    <nav className={styles.navigation} aria-label="管理功能">{[['/admin','總覽'],['/admin/questions','題目維護'],['/admin/users','會員管理'],['/admin/reports','回報管理']].map(([href,label]) => <Link key={href} href={href} aria-current={current === href ? 'page' : undefined}>{label}</Link>)}<Link href="/">首頁</Link></nav>
    <div className={styles.content}>{children}</div>
  </div></main>;
}

export function TableRegion({ label, children }: { label: string; children: ReactNode }) {
  return <div className={styles.table} role="region" aria-label={label} tabIndex={0}>{children}</div>;
}
