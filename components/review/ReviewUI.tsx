import Link from "next/link";
import type { ReactNode, CSSProperties } from "react";
import { StudyIcon } from "@/components/dashboard/StudyUI";
import { subjectPalette } from "@/app/analysis/analytics";
import foundation from "@/components/ui/foundation.module.css";
import layout from "@/components/ui/page-layout.module.css";
import PageHeader from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/ContentState";
import styles from "./review.module.css";

export function ReviewPage({ title, subtitle, count, children, action }: { title: string; subtitle: string; count: number; children: ReactNode; action?: ReactNode }) {
  return <main className={`${foundation.foundation} ${layout.page}`}><div className={styles.container}>
    <nav className={layout.breadcrumb} aria-label="麵包屑"><Link href="/" aria-label="回首頁"><StudyIcon name="home" />回首頁</Link><span aria-hidden="true">/</span><span aria-current="page">{title}</span></nav>
    <PageHeader title={title} description={subtitle} />
    <div className={styles.toolbar}><p>共 {count} 題</p>{action}</div>
    {children}
  </div></main>;
}

export function SubjectBadge({ subject }: { subject: string }) {
  const color = Object.hasOwn(subjectPalette, subject) ? subjectPalette[subject] : null;
  return <span className={styles.badge} style={color ? { "--subject-main": color.main, "--subject-light": color.light } as CSSProperties : undefined}>{subject}</span>;
}

export function ReviewEmptyState({ favorite = false }: { favorite?: boolean }) {
  return <EmptyState title={favorite ? "還沒有收藏的題目" : "目前沒有錯題"} description={favorite ? "遇到想再次複習的重要題目時，可以把它收藏起來。" : "做得不錯！之後答錯的題目會整理在這裡，方便你再次複習。"}>
    <Link className={styles.primary} href="/subjects">{favorite ? "去刷題" : "開始刷題"}<StudyIcon name="arrow" /></Link>
  </EmptyState>;
}
