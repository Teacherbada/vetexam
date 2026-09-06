import Link from "next/link";
import type { ReactNode } from "react";
import { StudyIcon } from "@/components/dashboard/StudyUI";
import analysis from "@/app/analysis/analysis.module.css";
import PolicyLinks from "./PolicyLinks";
import { POLICY_UPDATED } from "./policies";
import styles from "./policies.module.css";

export function PolicySection({ title, children }: { title: string; children: ReactNode }) {
  return <section className={styles.section}><h2>{title}</h2>{children}</section>;
}

export default function PolicyPage({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return <main className={analysis.page}><div className={styles.container}>
    <nav className={analysis.breadcrumb} aria-label="麵包屑"><Link href="/" aria-label="回首頁"><StudyIcon name="home" />回首頁</Link><span aria-hidden="true">/</span><span aria-current="page">{title}</span></nav>
    <header className={analysis.header}><div><p className={analysis.eyebrow}>VETEXAM · 網站資訊</p><h1>{title}</h1><p>{subtitle}</p></div></header>
    <article className={styles.card}>
      {children}
      <PolicySection title="政策更新"><p>VetExam 可能因服務內容、法令或營運需求更新本政策。若有重大變更，將於網站以適當方式公告。</p></PolicySection>
      <p className={styles.updated}>最後更新：<time dateTime={POLICY_UPDATED.iso}>{POLICY_UPDATED.label}</time></p>
    </article>
    <footer className={styles.footer} aria-label="VetExam 客服與網站資訊">
      <div><strong>VetExam</strong><p>如對本頁說明有疑問，歡迎聯絡客服。</p></div>
      <address><div><span>客服信箱</span><a href="mailto:vetexam.support.tw@gmail.com">vetexam.support.tw@gmail.com</a></div><div><span>客服電話</span><a href="tel:0988058090">0988-058-090</a></div></address>
      <PolicyLinks />
    </footer>
  </div></main>;
}
