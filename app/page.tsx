"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { dailyGoal } from "@/data/tasks";
import { authClient } from "@/lib/auth-client";
import { ProgressBar, StudyCompanions, StudyIcon, type StudyIconName } from "@/components/dashboard/StudyUI";
import "./home.css";
import PolicyLinks from "@/components/policies/PolicyLinks";
import { useHomeAvailability } from "@/components/dashboard/useHomeAvailability";
import HomeChapterStats from "@/components/dashboard/HomeChapterStats";
import WeeklyMostMissed from "@/components/dashboard/WeeklyMostMissed";

export default function Home() {
  const availability = useHomeAvailability();
  const [search, setSearch] = useState("");
  const [isLoadingProgress, setIsLoadingProgress] = useState(true);
  const [todayProgress, setTodayProgress] = useState(0);
  const [progress, setProgress] = useState<Record<string, { answered: number[]; correct: number; wrong: number }>>({});
  const [examDate, setExamDate] = useState("2027-07-31");

  const [user, setUser] = useState<{ name?: string; email: string } | null>(null);
  const [isLoadingUser, setIsLoadingUser] = useState(true);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

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

  useEffect(() => { if (!user) { setIsAdmin(false); return; } fetch("/api/admin/status", { cache: "no-store" }).then(response => response.ok ? response.json() : null).then(data => setIsAdmin(data?.isAdmin === true)).catch(() => setIsAdmin(false)); }, [user]);

  // 取得目前登入使用者
  useEffect(() => {
    const getSession = async () => {
      try {
        const result = await authClient.getSession();

        if (result.data?.user) {
          setUser(result.data.user);
        } else {
          setUser(null);
        }
      } catch (error) {
        console.error(
          "取得登入狀態失敗：",
          error
        );
        setUser(null);
      } finally {
        setIsLoadingUser(false);
      }
    };

    getSession();
  }, []);

  const handleLogout = async () => {
    try {
      setIsLoggingOut(true);

      await authClient.signOut();

      setUser(null);
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
    { href: "/manual", label: "手動建立題庫", icon: "file", comingSoon: true },
    { href: "/questions/search", label: "查詢題目", icon: "search" },
    { href: "/wrong", label: "錯題本", icon: "wrong" },
    { href: "/favorites", label: "收藏題", icon: "heart" },
    { href: "/analysis", label: "學習紀錄 / 弱點分析", icon: "chart" },
    { href: "/subscription", label: "會員方案", icon: "leaf" },
  ];
  const subjectIcons: StudyIconName[] = ["leaf", "file", "search", "heart", "target", "book"];
  const studied = subjects.filter((subject) => progress[subject]?.answered.length > 0);
  const completed = Object.values(progress).reduce((sum, item) => sum + item.answered.length, 0);
  const remaining = Math.max(0, dailyGoal.target - todayProgress);
  const visibleSubjects = subjects.filter((subject) => subject.includes(search.trim()));
  const subjectHref = (subject: string) => `/questions?${new URLSearchParams({ subjects: subject, count: "20", order: "random" })}`;
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
    <div className="study-home" lang="zh-Hant">
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
      <main id="main-content" className="study-content" tabIndex={-1}>
        <div className="study-welcome">
          <section className="study-hero">
            <p className="study-eyebrow">一起，向獸醫之路前進 <StudyIcon name="paw" /></p>
            <h1>今天也刷一點吧</h1>
            <p className="study-hero-description">每一題的累積，都是成為更好獸醫的力量。</p>
            <Link href="/subjects" className="study-button study-button-primary study-welcome-action">開始刷題<StudyIcon name="arrow" /></Link>
          </section>
          <div className="study-hero-visual"><p>Small progress.<br />A little closer, every day.</p><StudyCompanions /></div>
          <section className="study-card study-countdown"><h2><StudyIcon name="calendar" />國考倒數</h2><p className="study-days">{daysLeft}<span>天</span></p><label htmlFor="exam-date">我的目標考試日期</label><input id="exam-date" type="date" value={examDate} onChange={(event) => { if (event.target.value) { setExamDate(event.target.value); localStorage.setItem("examDate", event.target.value); } }} /><p className="study-muted">照自己的步調，準備每一天。</p></section>
        </div>
        <section className="study-card study-features" aria-labelledby="features-title">
          <h2 id="features-title"><StudyIcon name="paw" />VetExam 讓國考準備更有效率</h2>
          <p className="study-muted">從刷題、複習到分析，一站完成，陪你穩穩準備每一步。</p>
          <div className="study-feature-grid">{([
            { href: "/subjects", icon: "book", title: "國考題庫", description: "依科目、年份與章節系統化練習" },
            { href: "/questions/search", icon: "search", title: "查詢題目", description: "快速搜尋題目、關鍵字或特定章節" },
            { href: "/wrong", icon: "wrong", title: "錯題本", description: "集中複習曾經答錯的題目" },
            { href: "/favorites", icon: "heart", title: "收藏題", description: "把重要題目留下來反覆複習" },
            { href: "/analysis", icon: "chart", title: "弱點分析", description: "了解各科表現，找出需要加強的部分" },
            { href: "/most-missed", icon: "target", title: "本週熱門錯題", description: "看看其他考生最常答錯的題目" },
          ] satisfies { href: string; icon: StudyIconName; title: string; description: string }[]).map(({ href, icon, title, description }, index) => <Link href={href} key={href} className={"study-feature study-feature-" + index}><span className="study-feature-icon"><StudyIcon name={icon} /></span><h3>{title}</h3><p>{description}</p></Link>)}</div>
        </section>
        <div className="study-insights-grid">
          <WeeklyMostMissed variant="homepage" />
          <section className="study-card study-records" aria-labelledby="records-title">
            <div className="study-section-heading"><h2 id="records-title"><StudyIcon name="chart" />我的學習進度</h2><Link href="/analysis" className="study-text-link">查看詳情<StudyIcon name="arrow" /></Link></div>
            {isLoadingProgress ? <p className="study-empty">讀取學習進度中…</p> : completed ? <div className="study-progress-summary">
              <div className="study-accuracy" style={{ "--accuracy": Math.max(0, Math.min(accuracy, 100)) + "%" } as CSSProperties} role="img" aria-label={"整體正確率 " + accuracy + "%"}><span><strong>{accuracy}%</strong><small>整體正確率</small></span></div>
              <dl><div><dt>已答題數</dt><dd>{completed.toLocaleString()} 題</dd></div><div><dt>正確題數</dt><dd>{correct.toLocaleString()} 題</dd></div><div><dt>錯誤題數</dt><dd>{wrong.toLocaleString()} 題</dd></div><div><dt>整體正確率</dt><dd>{accuracy}%</dd></div></dl>
            </div> : <div className="study-empty"><StudyIcon name="book" /><h3>你的第一步，從這裡開始</h3><p>完成練習後，就能看見累積成果。</p></div>}
            <p className="study-progress-note"><StudyIcon name="leaf" />持續練習，讓每一次作答都更有把握。</p>
            <details className="study-record-details"><summary>各科累積紀錄<span>本裝置紀錄</span></summary>              {isLoadingProgress ? <p className="study-empty">讀取紀錄中…</p> : studied.length ? studied.map((subject) => { const record = progress[subject]; const accuracy = Math.round(record.correct / record.answered.length * 100); return <div className="study-record" key={subject}><div className="study-section-heading"><h3>{subject}</h3><span>已完成 {record.answered.length} 題</span></div><ProgressBar value={accuracy} label={`${subject}正確率`} /><div className="study-record-stats"><span>正確 {record.correct} 題 · 錯題 {record.wrong} 題</span><strong>正確率 {accuracy}%</strong></div></div>; }) : <div className="study-empty"><span className="study-empty-icon"><StudyIcon name="book" /></span><h3>你的第一步，從這裡開始</h3><p>完成練習後，就能在這裡看見各科累積成果。</p><Link href="/subjects" className="study-text-link">選擇第一個科目 <StudyIcon name="arrow" /></Link></div>}</details>
          </section>
        </div>
        <section className="study-card study-banks" aria-labelledby="banks-title">
          <div className="study-section-heading"><h2 id="banks-title"><StudyIcon name="book" />選擇題庫開始練習</h2><Link href="/subjects" className="study-text-link">查看全部題庫<StudyIcon name="arrow" /></Link></div>
          <div className="study-bank-tools"><p className="study-muted">依科目選擇題庫，或隨機 20 題立即開始練習。</p><details className="study-subject-filter"><summary><StudyIcon name="search" />篩選科目</summary><label><span>搜尋國考科目</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜尋國考科目…" /></label></details></div>
          <div className="study-bank-grid">{visibleSubjects.map(subject => <Link href={subjectHref(subject)} key={subject} className={"study-bank study-pastel-" + subjects.indexOf(subject)}><span className="study-subject-icon"><StudyIcon name={subjectIcons[subjects.indexOf(subject)]} /></span><h3>{subject}</h3><p>{availability.error ? "題數暫時無法載入" : !availability.data ? "讀取題數中…" : (subjectCounts.get(subject) ?? 0).toLocaleString() + " 題"}</p><span className="study-bank-action">開始練習<StudyIcon name="arrow" /></span></Link>)}</div>
          {visibleSubjects.length === 0 && <p className="study-empty" role="status">沒有符合的科目，試試「病理」或「藥理」。</p>}
          {availability.error && <button type="button" className="study-text-link" onClick={availability.retry}>重新載入題數<StudyIcon name="arrow" /></button>}
        </section>
        <div className="study-planning-grid">
          <HomeChapterStats rows={availability.data?.chapterAvailability ?? null} error={availability.error} retry={availability.retry} />
          <div className="study-side-cards">
          <section className="study-card study-goal" aria-labelledby="goal-title">
            <div className="study-goal-content"><div className="study-section-heading"><h2 id="goal-title"><StudyIcon name="target" />今日目標</h2><span className="study-tag">每天一小步</span></div>
              <p className="study-goal-count">{isLoadingProgress ? "—" : todayProgress}<span> / {dailyGoal.target} 題</span></p>
              <ProgressBar value={todayProgress / dailyGoal.target * 100} label="今日目標完成百分比" />
              <div className="study-goal-action"><p>{isLoadingProgress ? "讀取學習進度中…" : remaining ? <>再刷 <strong>{remaining}</strong> 題就完成今天目標！</> : "今日目標完成了，給努力的自己一點掌聲。"}</p><Link href="/subjects" className="study-button study-button-primary">{todayProgress > 0 ? "繼續刷題" : "開始刷題"}<StudyIcon name="arrow" /></Link></div>
            </div>
          </section>

            <section className="study-card study-achievement"><h2>學習小成就</h2><div><span className="study-subject-icon"><StudyIcon name="check" /></span><p>{isLoadingProgress ? "讀取中…" : `累積完成 ${completed} 題`}<small>一題一題，累積自己的實力。</small></p></div><Link href="/favorites" className="study-text-link"><StudyIcon name="heart" />重溫收藏的重點題目</Link></section>
          </div>
        </div>
          <footer className="study-footer" aria-label="VetExam 客服資訊">
            <div className="study-footer-brand"><b>VetExam</b><p>陪未來的獸醫，走好每一步。</p></div>
            <address className="study-footer-contact">
              <div><span>客服信箱</span><a href="mailto:vetexam.support.tw@gmail.com">vetexam.support.tw@gmail.com</a></div>
              <div><span>客服電話</span><a href="tel:0988058090">0988-058-090</a></div>
            </address>
            <PolicyLinks />
            <div className="study-footer-meta"><small>© 2026 VetExam. All rights reserved.</small><Link href="/feedback">聯絡與意見回饋 <StudyIcon name="arrow" /></Link></div>
          </footer>
      </main>
    </div>
  );
}
