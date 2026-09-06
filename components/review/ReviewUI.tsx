import Link from "next/link";
import type { ReactNode, CSSProperties } from "react";
import { StudyIcon } from "@/components/dashboard/StudyUI";
import { subjectPalette } from "@/app/analysis/analytics";
import analysis from "@/app/analysis/analysis.module.css";
import styles from "./review.module.css";

export function ReviewPage({ title, subtitle, count, children, action }: { title: string; subtitle: string; count: number; children: ReactNode; action?: ReactNode }) {
  return <main className={analysis.page}><div className={styles.container}>
    <nav className={analysis.breadcrumb} aria-label="麵包屑"><Link href="/" aria-label="回首頁"><StudyIcon name="home" />回首頁</Link><span aria-hidden="true">/</span><span aria-current="page">{title}</span></nav>
    <header className={analysis.header}><div><h1>{title}</h1><p>{subtitle}</p></div></header>
    <div className={styles.toolbar}><p>共 {count} 題</p>{action}</div>
    {children}
  </div></main>;
}

export function SubjectBadge({ subject }: { subject: string }) {
  const color = Object.hasOwn(subjectPalette, subject) ? subjectPalette[subject] : null;
  return <span className={styles.badge} style={color ? { "--subject-main": color.main, "--subject-light": color.light } as CSSProperties : undefined}>{subject}</span>;
}

export function ReviewEmptyState({ favorite = false }: { favorite?: boolean }) {
  return <section className={styles.empty}>
    <span className={styles.emptyIcon}><StudyIcon name={favorite ? "heart" : "leaf"} /></span>
    <h2>{favorite ? "還沒有收藏的題目" : "目前沒有錯題"}</h2>
    <p>{favorite ? <>遇到想再次複習的重要題目時，<br />可以把它收藏起來。</> : <>做得不錯！之後答錯的題目會整理在這裡，<br />方便你再次複習。</>}</p>
    <Link className={styles.primary} href="/subjects">{favorite ? "去刷題" : "開始刷題"}<StudyIcon name="arrow" /></Link>
  </section>;
}
