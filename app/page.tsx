"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { dailyGoal } from "@/data/tasks";
import { authClient } from "@/lib/auth-client";
import { ProgressBar, StudyCompanions, StudyIcon, type StudyIconName } from "@/components/dashboard/StudyUI";
import "./home.css";

export default function Home() {
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
    { href: "/wrong", label: "錯題本", icon: "wrong" },
    { href: "/favorites", label: "收藏題", icon: "heart" },
    { href: "/analysis", label: "學習紀錄 / 弱點分析", icon: "chart" },
  ];
  const subjectIcons: StudyIconName[] = ["leaf", "file", "search", "heart", "target", "book"];
  const studied = subjects.filter((subject) => progress[subject]?.answered.length > 0);
  const completed = Object.values(progress).reduce((sum, item) => sum + item.answered.length, 0);
  const remaining = Math.max(0, dailyGoal.target - todayProgress);
  const visibleSubjects = subjects.filter((subject) => subject.includes(search.trim()));
  const subjectHref = (subject: string) => `/questions?${new URLSearchParams({ subjects: subject, count: "20", order: "random" })}`;
  const navLinks = navigation.map(({ href, label, icon, comingSoon }) => comingSoon ? <span key={href} className="study-nav-link-disabled" aria-disabled="true"><StudyIcon name={icon} /><span>{label}</span><small>敬請期待 ✨</small></span> : <Link key={href} href={href} aria-current={href === "/" ? "page" : undefined}><StudyIcon name={icon} />{label}</Link>);

  return (
    <div className="study-home" lang="zh-Hant">
      <a className="study-skip" href="#main-content">跳至主要內容</a>
      <aside className="study-sidebar">
        <Link href="/" className="study-brand"><span className="study-brand-icon"><StudyIcon name="paw" /></span><span>VetExam<small>刷題，讓你更靠近夢想</small></span></Link>
        <p className="study-nav-label">學習空間</p>
        <nav aria-label="主要導覽">{navLinks}</nav>
        <div className="study-sidebar-note"><StudyIcon name="leaf" /><p>慢慢累積，穩穩前進。<small>每一題，都離夢想更近一點。</small></p></div>
      </aside>
      <div className="study-body">
        <header className="study-header">
          <details className="study-mobile-nav"><summary aria-label="開啟導覽選單"><StudyIcon name="menu" /><b>VetExam</b></summary><nav aria-label="行動版導覽">{navLinks}</nav></details>
          <span className="study-breadcrumb">我的學習空間 <span>/</span> 首頁</span>
          <div className="study-account" aria-live="polite">
            {isLoadingUser ? <span className="study-muted">讀取帳號中…</span> : user ? <>
              <span className="study-avatar" aria-hidden="true">{(user.name || user.email).slice(0, 1).toUpperCase()}</span>
              <details className="study-account-menu"><summary>{user.name || user.email}<span aria-hidden="true">⌄</span></summary><div><p>{user.email}</p><button className="study-button" onClick={handleLogout} disabled={isLoggingOut}>{isLoggingOut ? "登出中…" : "登出"}</button></div></details>
            </> : <><Link href="/login" className="study-button">登入</Link><Link href="/register" className="study-register">建立帳號 <StudyIcon name="arrow" /></Link></>}
          </div>
        </header>
        <main id="main-content" className="study-content" tabIndex={-1}>
          <section className="study-hero"><p className="study-eyebrow">一起，向獸醫之路前進</p><h1>今天也刷一點吧 <StudyIcon name="leaf" /></h1><p>每一題的累積，都是成為更好獸醫的力量。</p></section>
          <section className="study-card study-goal" aria-labelledby="goal-title">
            <div className="study-goal-content"><div className="study-section-heading"><h2 id="goal-title"><StudyIcon name="target" />今日目標</h2><span className="study-tag">每天一小步</span></div>
              <p className="study-goal-count">{isLoadingProgress ? "—" : todayProgress}<span> / {dailyGoal.target} 題</span></p>
              <ProgressBar value={todayProgress / dailyGoal.target * 100} label="今日目標完成百分比" />
              <div className="study-goal-action"><p>{isLoadingProgress ? "讀取學習進度中…" : remaining ? <>再刷 <strong>{remaining}</strong> 題就完成今天目標！</> : "今日目標完成了，給努力的自己一點掌聲。"}</p><Link href="/subjects" className="study-button study-button-primary">{todayProgress > 0 ? "繼續刷題" : "開始刷題"}<StudyIcon name="arrow" /></Link></div>
            </div>
            <div className="study-illustration"><StudyCompanions /><p>每天進步一點點。</p><small>Small progress makes a big difference.</small></div>
          </section>
          <section className="study-banks" aria-labelledby="banks-title">
            <div className="study-section-heading"><div><h2 id="banks-title">選擇題庫開始練習</h2><p className="study-muted">從一個科目開始，每次練習 20 題。</p></div><Link href="/subjects" className="study-text-link">自訂練習 <StudyIcon name="arrow" /></Link></div>
            <label className="study-search"><StudyIcon name="search" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜尋國考科目…" aria-label="搜尋國考科目" /></label>
            <div className="study-bank-grid">{visibleSubjects.map((subject) => <Link className="study-card study-bank" href={subjectHref(subject)} key={subject}><span className={`study-subject-icon study-pastel-${subjects.indexOf(subject)}`}><StudyIcon name={subjectIcons[subjects.indexOf(subject)]} /></span><span><h3>{subject}</h3><p>{isLoadingProgress ? "讀取進度中…" : `已練習 ${progress[subject]?.answered.length || 0} 題`}<span> · 隨機練習</span></p></span><StudyIcon name="chevron" /></Link>)}</div>
            {visibleSubjects.length === 0 && <p className="study-empty" role="status">沒有符合的科目，試試「病理」或「藥理」。</p>}
          </section>
          <div className="study-bottom-grid">
            <section className="study-card study-records" aria-labelledby="records-title"><div className="study-section-heading"><h2 id="records-title">學習進度</h2><Link className="study-text-link" href="/analysis">查看分析 <StudyIcon name="arrow" /></Link></div><p className="study-muted study-record-note">本裝置累積紀錄・目前未提供練習日期與續答位置</p>
              {isLoadingProgress ? <p className="study-empty">讀取紀錄中…</p> : studied.length ? studied.map((subject) => { const record = progress[subject]; const accuracy = Math.round(record.correct / record.answered.length * 100); return <div className="study-record" key={subject}><div className="study-section-heading"><h3>{subject}</h3><span>已完成 {record.answered.length} 題</span></div><ProgressBar value={accuracy} label={`${subject}正確率`} /><div className="study-record-stats"><span>正確 {record.correct} 題 · 錯題 {record.wrong} 題</span><strong>正確率 {accuracy}%</strong></div></div>; }) : <div className="study-empty"><span className="study-empty-icon"><StudyIcon name="book" /></span><h3>你的第一步，從這裡開始</h3><p>完成練習後，就能在這裡看見各科累積成果。</p><Link href="/subjects" className="study-text-link">選擇第一個科目 <StudyIcon name="arrow" /></Link></div>}
            </section>
            <div className="study-side-cards"><section className="study-card study-achievement"><h2>學習小成就</h2><div><span className="study-subject-icon"><StudyIcon name="check" /></span><p>{isLoadingProgress ? "讀取中…" : `累積完成 ${completed} 題`}<small>一題一題，累積自己的實力。</small></p></div><Link href="/favorites" className="study-text-link"><StudyIcon name="heart" />重溫收藏的重點題目</Link></section>
              <section className="study-card study-countdown"><h2><StudyIcon name="calendar" />國考倒數</h2><p className="study-days">{daysLeft}<span>天</span></p><label htmlFor="exam-date">我的目標考試日期</label><input id="exam-date" type="date" value={examDate} onChange={(event) => { if (event.target.value) { setExamDate(event.target.value); localStorage.setItem("examDate", event.target.value); } }} /><p className="study-muted">照自己的步調，準備每一天。</p></section>
            </div>
          </div>
          <footer className="study-footer"><span><b>VetExam</b>｜陪未來的獸醫，走好每一步。</span><Link href="/feedback">聯絡與意見回饋 <StudyIcon name="arrow" /></Link></footer>
        </main>
      </div>
    </div>
  );
}
