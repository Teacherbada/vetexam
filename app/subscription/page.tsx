import Link from "next/link";
import { headers } from "next/headers";
import { StudyIcon } from "@/components/dashboard/StudyUI";
import { getUserSubscription } from "@/lib/subscription";
import analysisStyles from "@/app/analysis/analysis.module.css";
import styles from "./subscription.module.css";
import { getBillingView } from "@/lib/payment/view";
import Pricing from "./Pricing";
import PlanInformation from "./PlanInformation";
import PolicyLinks from "@/components/policies/PolicyLinks";
import AccountStatus from "./AccountStatus";
import accountStyles from "./account.module.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type PageProps = { searchParams: Promise<{ view?: string | string[] }> };
export async function generateMetadata({ searchParams }: PageProps) {
  return (await searchParams).view === "account"
    ? { title: "我的方案 | VetExam", description: "查看目前的 VetExam 方案與訂閱狀態。", robots: { index: false, follow: false } }
    : { title: "PRO 訂閱方案 | VetExam", description: "查看 PRO 月繳、半年與年度方案、30 天免費試用條件及客服資訊。" };
}

export default async function SubscriptionPage({ searchParams }: PageProps) {
  const accountView = (await searchParams).view === "account";
  let result: Awaited<ReturnType<typeof getUserSubscription>> = null;
  let unavailable = false;
  try {
    result = await getUserSubscription(await headers());
  } catch {
    unavailable = true;
  }
  const access = result?.access;
  let billing: Awaited<ReturnType<typeof getBillingView>> | null = null;
  try { billing = await getBillingView(result?.user.id); } catch { /* Keep known membership data when billing is unavailable. */ }

  return <main className={analysisStyles.page}><div className={styles.container}>
    <nav className={analysisStyles.breadcrumb} aria-label="麵包屑">
      <Link href="/" aria-label="回首頁"><StudyIcon name="home" />回首頁</Link>
      <span aria-hidden="true">/</span><span aria-current="page">{accountView ? "我的方案" : "會員方案"}</span>
    </nav>
    {accountView && <header className={analysisStyles.header}><div><h1>我的方案</h1><p>查看目前的 VetExam 方案與訂閱狀態。</p></div></header>}
    <nav className={accountStyles.tabs} aria-label="訂閱頁面導覽"><Link className="study-button" href="/subscription" aria-current={!accountView ? "page" : undefined}>PRO 方案</Link><Link className="study-button" href="/subscription?view=account" aria-current={accountView ? "page" : undefined}>我的方案</Link></nav>
    {accountView ? <AccountStatus member={result} billing={billing} unavailable={unavailable} /> : <>
    <header className={styles.hero}>
      <p className={styles.eyebrow}>陪你穩穩前進 · VETEXAM</p>
      <h1>VetExam <span>PRO</span></h1>
      <p>更完整的刷題體驗，陪你一步一步準備獸醫國考。</p>
      <div className={styles.trialBanner}><strong>新會員享 30 天 PRO 免費體驗</strong><span>無需綁定信用卡 · 每個帳號限享一次</span></div>
      <p className={styles.heroNote}>體驗期結束後不會自動扣款。若想繼續使用 PRO，可自行選擇訂閱方案並完成付款。</p>
    </header>
    <Pricing signedIn={Boolean(result)} managed={billing?.managed ?? false} hasPro={Boolean(access?.hasProAccess)} enabled={billing?.enabled ?? false} expired={access?.status === "expired"} monthlyMatches={billing?.terms.amountMinor === 19900 && billing?.terms.trialDays === 0} />
    <PlanInformation />
    </>}
    <footer className={styles.contactFooter} aria-label="VetExam 客服資訊">
      <div><strong>VetExam</strong><p>{accountView ? "訂閱需要協助？" : "個人賣家"}</p></div>
      <address><div><span>客服信箱</span><a href="mailto:vetexam.support.tw@gmail.com">vetexam.support.tw@gmail.com</a></div><div><span>客服電話</span><a href="tel:0988058090">0988-058-090</a></div></address>
      <Link href="/feedback">聯絡與意見回饋 <StudyIcon name="arrow" /></Link>
      <PolicyLinks />
    </footer>
  </div></main>;
}
