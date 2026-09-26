"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";
import { getLearningSummary, getSummaryStatus, getLearningStatus, learningOwner, subscribeLearning } from '@/lib/learning-client';
import { buildQuizUrl } from '@/lib/quiz-url';
import { readAdminStatus } from '@/lib/admin-status-client';
import LearningStatus from '@/components/LearningStatus';
import { dailyGoal } from "@/data/tasks";
import { authClient } from "@/lib/auth-client";
import { ProgressBar, StudyIcon, type StudyIconName } from "@/components/dashboard/StudyUI";
import "./home.css";
import foundation from "@/components/ui/foundation.module.css";
import styles from "./home-foundation.module.css";
import { LoadingState } from "@/components/ui/ContentState";
import PolicyLinks from "@/components/policies/PolicyLinks";
import { useHomeAvailability } from "@/components/dashboard/useHomeAvailability";
import HomeChapterStats from "@/components/dashboard/HomeChapterStats";
import HomeLayout from "@/components/dashboard/HomeLayout";
import HomeJourney from "@/components/dashboard/HomeJourney";
import HomeIllustration from "@/components/dashboard/HomeIllustration";
import useHomeMotion from "@/components/dashboard/useHomeMotion";
import WeeklyMostMissed from "@/components/dashboard/WeeklyMostMissed";

export default function Home() {
  const availability = useHomeAvailability();
  const [search, setSearch] = useState("");
  const [isLoadingLocalProgress, setIsLoadingProgress] = useState(true);
  const [localTodayProgress, setTodayProgress] = useState(0);
  const [localProgress, setProgress] = useState<Record<string, { answered: number[]; correct: number; wrong: number }>>({});
  const { data: session, isPending: isLoadingUser } = authClient.useSession();
  const user = session?.user ?? null;
  const userId = user?.id ?? null;
  const account = useSyncExternalStore(subscribeLearning, getLearningSummary, () => null);
  const summaryStatus = useSyncExternalStore(subscribeLearning, getSummaryStatus, () => 'loading');
  const syncStatus = useSyncExternalStore(subscribeLearning, getLearningStatus, () => 'loading');
  const matchingAccount = user && account?.owner === user.id ? account : null;
  const identityReady = !isLoadingUser && learningOwner() === (user?.id ?? null);
  const progress = user ? matchingAccount?.progress ?? {} : identityReady ? Object.fromEntries(Object.entries(localProgress).map(([subject,row]) => [subject, { completed: row.answered.length, correct: row.correct, wrong: row.wrong }])) : {};
  const todayProgress = user ? matchingAccount?.todayCompleted ?? 0 : identityReady ? localTodayProgress : 0;
  const isLoadingProgress = !identityReady || isLoadingLocalProgress || (!!user && !matchingAccount && summaryStatus !== 'error');
  const summaryError = !!user && !matchingAccount && summaryStatus === 'error';
  const motionRoot = useHomeMotion(true);
  const [examDate, setExamDate] = useState("2027-07-31");

  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [adminStatus, setAdminStatus] = useState<{ owner: string; allowed: boolean } | null>(null);
  const isAdmin = !!userId && adminStatus?.owner === userId && adminStatus.allowed;

  useEffect(() => {
    const data = JSON.parse(
      localStorage.getItem("progress") || "{}"
    );

    // Hydrate existing browser-only records after mount to preserve server rendering.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProgress(data);

    const daily = JSON.parse(
      localStorage.getItem("dailyProgress") || "{}"
    );

    const today = new Date().toISOString().split("T")[0];

    setTodayProgress(
      daily[today]?.completed || 0
    );

    setIsLoadingProgress(false);
    const savedExamDate =
      localStorage.getItem("examDate");

    if (savedExamDate) {
      setExamDate(savedExamDate);
    } else {
      localStorage.setItem(
        "examDate",
        "2027-07-31"
      );
    }
  }, []);

  useEffect(() => {
    let active = true;
    if (userId) void readAdminStatus(userId).then(allowed => { if (active) setAdminStatus({ owner: userId, allowed }); });
    return () => { active = false; };
  }, [userId]);

  const handleLogout = async () => {
    try {
      setIsLoggingOut(true);

      await authClient.signOut();

    } catch (error) {
      console.error(
        "登出失敗：",
        error
      );
    } finally {
      setIsLoggingOut(false);
    }
  };

  const today = new Date();

  const targetDate = new Date(examDate);

  const diffTime =
    targetDate.getTime() - today.getTime();

  const daysLeft = Math.max(
    0,
    Math.ceil(
      diffTime /
        (1000 * 60 * 60 * 24)
    )
  );

  const subjects = [
    "獸醫病理學",
    "獸醫藥理學",
    "獸醫實驗診斷學",
    "獸醫普通疾病學",
    "獸醫傳染病學",
    "獸醫公共衛生學",
  ];

  const navigation: { href: string; label: string; icon: StudyIconName; comingSoon?: boolean }[] = [
    { href: "/", label: "首頁", icon: "home" },
    { href: "/subjects", label: "國考題庫", icon: "book" },
    ...(isAdmin ? [{ href: "/pdf", label: "國考解析", icon: "folder" as StudyIconName }] : []),
    { href: "/study-plan", label: "設定學習計畫", icon: "calendar" },
    { href: "/manual", label: "手動建立題庫", icon: "file", comingSoon: true },
    { href: "/questions/search", label: "查詢題目", icon: "search" },
    { href: "/wrong", label: "錯題本", icon: "wrong" },
    { href: "/favorites", label: "收藏題", icon: "heart" },
    { href: "/analysis", label: "學習紀錄 / 弱點分析", icon: "chart" },
    { href: "/subscription", label: "會員方案", icon: "leaf" },
  ];
  const subjectIcons: StudyIconName[] = ["leaf", "file", "search", "heart", "target", "book"];
  const studied = subjects.filter((subject) => progress[subject]?.completed > 0);
  const completed = Object.values(progress).reduce((sum, item) => sum + item.completed, 0);
  const remaining = Math.max(0, dailyGoal.target - todayProgress);
  const visibleSubjects = subjects.filter((subject) => subject.includes(search.trim()));
  const subjectHref = (subject: string) => buildQuizUrl([{ subject, years: [], count: '20' }], 'random', 'practice', 'all');
  const navLinks = navigation.map(({ href, label, icon, comingSoon }) => comingSoon ? <span key={href} className="study-nav-link-disabled" aria-disabled="true"><StudyIcon name={icon} /><span>{label}</span><small>敬請期待 ✨</small></span> : <Link key={href} href={href} aria-current={href === "/" ? "page" : undefined}><StudyIcon name={icon} />{label}</Link>);

  const correct = Object.values(progress).reduce((sum, item) => sum + item.correct, 0);
  const wrong = Object.values(progress).reduce((sum, item) => sum + item.wrong, 0);
  const accuracy = completed ? Math.round(correct / completed * 100) : 0;
  const subjectCounts = new Map<string, number>();
  for (const row of availability.data?.availability ?? []) {
    const count = Number(row?.count);
    if (row && subjects.includes(row.subject) && Number.isSafeInteger(count) && count >= 0) subjectCounts.set(row.subject, (subjectCounts.get(row.subject) ?? 0) + count);
  }

  return (
    <div className={`study-home ${foundation.foundation} ${styles.home}`} lang="zh-Hant">
      <a className="study-skip" href="#main-content">跳至主要內容</a>
      <header className="study-header">
        <div className="study-header-inner">
          <Link href="/" className="study-brand"><span className="study-brand-icon"><StudyIcon name="paw" /></span><span>VetExam<small>刷題，讓你更靠近夢想</small></span></Link>
          <nav className="study-desktop-nav" aria-label="主要導覽">{navLinks}</nav>
          <details className="study-mobile-nav"><summary aria-label="開啟導覽選單"><StudyIcon name="menu" /></summary><nav aria-label="行動版導覽">{navLinks}</nav></details>
          <div className="study-account" aria-live="polite">
            {isLoadingUser ? <span className="study-muted">讀取帳號中…</span> : user ? <>
              <span className="study-avatar" aria-hidden="true">{(user.name || user.email).slice(0, 1).toUpperCase()}</span>
              <details className="study-account-menu"><summary>{user.name || user.email}<span aria-hidden="true">⌄</span></summary><div><p>{user.email}</p><button className="study-button" onClick={handleLogout} disabled={isLoggingOut}>{isLoggingOut ? "登出中…" : "登出"}</button></div></details>
            </> : <><Link href="/login" className="study-button">登入</Link><Link href="/register" className="study-register">建立帳號 <StudyIcon name="arrow" /></Link></>}
          </div>
        </div>
      </header>
      <main ref={motionRoot} id="main-content" className="study-content" tabIndex={-1}>
        <HomeLayout illustration={<HomeIllustration />} introduction={<HomeJourney />} hero={<section className="study-hero" data-home-reveal>
            <p className="study-eyebrow">一起，向獸醫之路前進 <StudyIcon name="paw" /></p>
            <h1>今天也刷一點吧！</h1>
            <p className="study-hero-description">每一題的累積，都是成為更好獸醫的力量。</p>
            <div className={styles.heroActions}><Link href="/subjects" className="study-button study-button-primary">開始刷題<StudyIcon name="arrow" /></Link><Link href="/study-plan" className="study-button">設定學習計畫<StudyIcon name="calendar" /></Link></div>
          </section>} visual={<section className={styles.heroStatus} aria-labelledby="home-status-title">
            <div className={styles.statusHeading}><div><p className={styles.kicker}>{user ? '帳號紀錄' : '本裝置紀錄'}</p><h2 id="home-status-title">今日學習狀態</h2></div><span className={styles.statusIcon}><StudyIcon name="leaf" /></span></div>
            <div className={styles.statusBody}>{isLoadingProgress ? <p role="status" className={styles.statusMessage}>讀取學習進度中…</p> : summaryError ? <p className={styles.statusMessage}>學習紀錄暫時無法更新。</p> : completed ? <>
              <p className={styles.todayCount}><strong>{todayProgress}</strong><span> / {dailyGoal.target} 題 · 今日目標</span></p>
              <ProgressBar value={todayProgress / dailyGoal.target * 100} label="今日學習完成百分比" />
              <div className={styles.statusFooter}><span>今天已完成</span><Link href="/analysis" className="study-text-link">查看學習紀錄<StudyIcon name="arrow" /></Link></div>
            </> : <div className={styles.statusMessage}><h3>你的第一步，從這裡開始</h3><p>完成練習後，就能看見累積成果。</p><p className={styles.firstGoal}>今日目標 {dailyGoal.target} 題，照自己的步調開始。</p></div>}</div>
            <dl className={styles.statusMetrics}><div><dt>今日完成</dt><dd>{isLoadingProgress || summaryError ? '—' : todayProgress}<small> 題</small></dd></div><div><dt>正確率</dt><dd>{isLoadingProgress || summaryError ? '—' : `${accuracy}%`}</dd></div><div><dt>累積題數</dt><dd>{isLoadingProgress || summaryError ? '—' : completed.toLocaleString()}<small> 題</small></dd></div></dl>
          </section>}>
          {{
            "due-review": (<section className="study-card study-due"><h2><StudyIcon name="book" />到期複習</h2><p className={styles.reviewLead}>讓學過的，再熟悉一點。</p><p className="study-muted">查看記憶排程，練習已到期的題目。</p><Link href="/review" className="study-text-link">查看到期複習<StudyIcon name="arrow" /></Link></section>),
            "countdown": (<section className="study-card study-countdown"><h2><StudyIcon name="calendar" />國考倒數</h2><p className="study-days">{daysLeft}<span>天</span></p><label htmlFor="exam-date">我的目標考試日期</label><input id="exam-date" type="date" value={examDate} onChange={(event) => { if (event.target.value) { setExamDate(event.target.value); localStorage.setItem("examDate", event.target.value); } }} /><p className="study-muted">照自己的步調，準備每一天。</p></section>),
            "features": (<section className="study-card study-features" aria-labelledby="features-title">
          <h2 id="features-title"><StudyIcon name="paw" />更多學習工具</h2>
          <p className="study-muted">從刷題、複習到分析，一站完成，陪你穩穩準備每一步。</p>
          <div className="study-feature-grid">{([
            { href: "/subjects", icon: "book", title: "國考題庫", description: "依科目、年份與章節系統化練習" },
            { href: "/questions/search", icon: "search", title: "查詢題目", description: "快速搜尋題目、關鍵字或特定章節" },
            { href: "/wrong", icon: "wrong", title: "錯題本", description: "集中複習曾經答錯的題目" },
            { href: "/favorites", icon: "heart", title: "收藏題", description: "把重要題目留下來反覆複習" },
            { href: "/analysis", icon: "chart", title: "弱點分析", description: "了解各科表現，找出需要加強的部分" },
            { href: "/most-missed", icon: "target", title: "本週熱門錯題", description: "看看其他考生最常答錯的題目" },
          ] satisfies { href: string; icon: StudyIconName; title: string; description: string }[]).map(({ href, icon, title, description }, index) => <Link href={href} key={href} className={"study-feature study-feature-" + index}><span className="study-feature-icon"><StudyIcon name={icon} /></span><h3>{title}</h3><p>{description}</p><span className={styles.featureArrow} aria-hidden="true"><StudyIcon name="arrow" /></span></Link>)}</div>
        </section>),
            "weekly-most-missed": (<WeeklyMostMissed variant="homepage" loading={<LoadingState label="正在整理本週錯題…" />} />),
            "progress": (<section className="study-card study-records" aria-labelledby="records-title">
            {syncStatus === 'error' && <LearningStatus />}
            <div className="study-section-heading"><h2 id="records-title"><StudyIcon name="chart" />你的學習狀況</h2><Link href="/analysis" className="study-text-link">查看詳情<StudyIcon name="arrow" /></Link></div>
            {isLoadingProgress ? <LoadingState label="讀取學習進度中…" /> : completed ? <div className="study-progress-summary">
              <div className="study-accuracy" style={{ "--accuracy": Math.max(0, Math.min(accuracy, 100)) + "%" } as CSSProperties} role="img" aria-label={"整體正確率 " + accuracy + "%"}><span><strong>{accuracy}%</strong><small>整體正確率</small></span></div>
              <dl><div><dt>已答題數</dt><dd>{completed.toLocaleString()} 題</dd></div><div><dt>正確題數</dt><dd>{correct.toLocaleString()} 題</dd></div><div><dt>錯誤題數</dt><dd>{wrong.toLocaleString()} 題</dd></div><div><dt>整體正確率</dt><dd>{accuracy}%</dd></div></dl>
            </div> : <div className="study-empty"><StudyIcon name="book" /><h3>你的第一步，從這裡開始</h3><p>完成練習後，就能看見累積成果。</p></div>}
            <p className="study-progress-note"><StudyIcon name="leaf" />持續練習，讓每一次作答都更有把握。</p>
            <details className="study-record-details"><summary>各科累積紀錄<span>{user ? '帳號紀錄' : '本裝置紀錄'}</span></summary>              {isLoadingProgress ? <LoadingState label="讀取紀錄中…" /> : studied.length ? studied.map((subject) => { const record = progress[subject]; const accuracy = Math.round(record.correct / record.completed * 100); return <div className="study-record" key={subject}><div className="study-section-heading"><h3>{subject}</h3><span>已完成 {record.completed} 題</span></div><ProgressBar value={accuracy} label={`${subject}正確率`} /><div className="study-record-stats"><span>正確 {record.correct} 題 · 錯題 {record.wrong} 題</span><strong>正確率 {accuracy}%</strong></div></div>; }) : <div className="study-empty"><span className="study-empty-icon"><StudyIcon name="book" /></span><h3>你的第一步，從這裡開始</h3><p>完成練習後，就能在這裡看見各科累積成果。</p><Link href="/subjects" className="study-text-link">選擇第一個科目 <StudyIcon name="arrow" /></Link></div>}</details>
          </section>),
            "subjects": (<section className="study-card study-banks" aria-labelledby="banks-title">
          <div className="study-section-heading"><h2 id="banks-title"><StudyIcon name="book" />選擇題庫開始練習</h2><Link href="/subjects" className="study-text-link">查看全部題庫<StudyIcon name="arrow" /></Link></div>
          <div className="study-bank-tools"><p className="study-muted">依科目選擇題庫，或隨機 20 題立即開始練習。</p><details className="study-subject-filter"><summary><StudyIcon name="search" />篩選科目</summary><label><span>搜尋國考科目</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜尋國考科目…" /></label></details></div>
          <div className="study-bank-grid">{visibleSubjects.map(subject => <Link href={subjectHref(subject)} key={subject} className={"study-bank study-pastel-" + subjects.indexOf(subject)}><span className="study-subject-icon"><StudyIcon name={subjectIcons[subjects.indexOf(subject)]} /></span><h3>{subject}</h3><p>{availability.error ? "題數暫時無法載入" : !availability.data ? "讀取題數中…" : (subjectCounts.get(subject) ?? 0).toLocaleString() + " 題"}</p><span className="study-bank-action">開始練習<StudyIcon name="arrow" /></span></Link>)}</div>
          {visibleSubjects.length === 0 && <p className="study-empty" role="status">沒有符合的科目，試試「病理」或「藥理」。</p>}
          {availability.error && <button type="button" className="study-text-link" onClick={availability.retry}>重新載入題數<StudyIcon name="arrow" /></button>}
        </section>),
            "chapter-stats": (<HomeChapterStats rows={availability.data?.chapterAvailability ?? null} error={availability.error} retry={availability.retry} />),
            "daily-goal": (<section className="study-card study-goal" aria-labelledby="goal-title">
            <div className="study-goal-content"><div className="study-section-heading"><h2 id="goal-title"><StudyIcon name="target" />今日目標</h2><span className="study-tag">每天一小步</span></div>
              <p className="study-goal-count">{isLoadingProgress ? "—" : todayProgress}<span> / {dailyGoal.target} 題</span></p>
              <ProgressBar value={todayProgress / dailyGoal.target * 100} label="今日目標完成百分比" />
              <div className="study-goal-action"><p>{isLoadingProgress ? "讀取學習進度中…" : remaining ? <>再刷 <strong>{remaining}</strong> 題就完成今天目標！</> : "今日目標完成了，給努力的自己一點掌聲。"}</p><Link href="/subjects" className="study-button study-button-primary">{todayProgress > 0 ? "繼續刷題" : "開始刷題"}<StudyIcon name="arrow" /></Link></div>
            </div>
          </section>),
            "achievement": (<section className="study-card study-achievement"><h2>學習小成就</h2><div><span className="study-subject-icon"><StudyIcon name="check" /></span><p>{isLoadingProgress ? "讀取中…" : `累積完成 ${completed} 題`}<small>一題一題，累積自己的實力。</small></p></div><Link href="/favorites" className="study-text-link"><StudyIcon name="heart" />重溫收藏的重點題目</Link></section>)
          }}
        </HomeLayout>
          <footer className="study-footer" aria-label="VetExam 客服資訊">
            <div className="study-footer-brand"><b>VetExam</b><p>陪未來的獸醫，走好每一步。</p></div>
            <address className="study-footer-contact">
              <div><span>客服信箱</span><a href="mailto:vetexam.support.tw@gmail.com">vetexam.support.tw@gmail.com</a></div>
              <div><span>Instagram</span><a href="https://www.instagram.com/vetexam.tw/">@vetexam.tw</a></div>
              <div><span>Threads</span><a href="https://www.threads.net/@vetexam.tw">@vetexam.tw</a></div>
            </address>
            <PolicyLinks />
            <nav className={styles.footerUtilities} aria-label="網站協助"><Link href="/feedback" className="study-text-link">回報問題<StudyIcon name="arrow" /></Link>{isAdmin && <Link href="/admin" className="study-text-link">後台管理<StudyIcon name="arrow" /></Link>}</nav>
            <div className="study-footer-meta"><small>© 2026 VetExam. All rights reserved.</small><Link href="/feedback">聯絡與意見回饋 <StudyIcon name="arrow" /></Link></div>
          </footer>
      </main>
    </div>
  );
}
