"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { dailyGoal } from "@/data/tasks";
import { authClient } from "@/lib/auth-client";

export default function Home() {
  const [todayProgress, setTodayProgress] = useState(0);
  const [progress, setProgress] = useState<any>({});
  const [examDate, setExamDate] = useState("2027-07-31");

  const [user, setUser] = useState<any>(null);
  const [isLoadingUser, setIsLoadingUser] = useState(true);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    const data = JSON.parse(
      localStorage.getItem("progress") || "{}"
    );

    setProgress(data);

    const daily = JSON.parse(
      localStorage.getItem("dailyProgress") || "{}"
    );

    const today = new Date().toISOString().split("T")[0];

    setTodayProgress(
      daily[today]?.completed || 0
    );

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

  return (
    <main className="min-h-screen bg-gray-50 px-6 py-12">
      <div className="mx-auto max-w-5xl">

        {/* 頂部標題與登入區 */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-5xl font-bold text-blue-900">
              VetExam
            </h1>

            <p className="mt-4 text-xl text-gray-600">
              獸醫國考 AI 學習平台
            </p>
          </div>

          {/* 登入狀態 */}
          {!isLoadingUser && (
            <div className="flex items-center gap-3">
              {user ? (
                <>
                  <div className="hidden rounded-lg bg-white px-4 py-2 shadow sm:block">
                    <p className="text-sm text-gray-500">
                      已登入
                    </p>

                    <p className="max-w-[220px] truncate font-medium text-gray-800">
                      {user.email}
                    </p>
                  </div>

                  <button
                    onClick={handleLogout}
                    disabled={isLoggingOut}
                    className="rounded-lg bg-gray-800 px-5 py-3 font-medium text-white shadow hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isLoggingOut
                      ? "登出中..."
                      : "登出"}
                  </button>
                </>
              ) : (
                <>
                  <Link
                    href="/login"
                    className="rounded-lg border border-blue-600 bg-white px-5 py-3 font-medium text-blue-600 shadow hover:bg-blue-50"
                  >
                    登入
                  </Link>

                  <Link
                    href="/register"
                    className="rounded-lg bg-blue-600 px-5 py-3 font-medium text-white shadow hover:bg-blue-700"
                  >
                    註冊
                  </Link>
                </>
              )}
            </div>
          )}
        </div>

        {/* 國考倒數 */}
        <section className="mt-10 rounded-2xl bg-white p-8 shadow">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold">
              📅 距離獸醫師國考
            </h2>

            <input
              type="date"
              value={examDate}
              onChange={(e) => {
                setExamDate(e.target.value);

                localStorage.setItem(
                  "examDate",
                  e.target.value
                );
              }}
              className="rounded-lg border px-3 py-2"
            />
          </div>

          <p className="mt-6 text-6xl font-bold text-blue-600">
            {daysLeft} 天
          </p>

          <p className="mt-4 text-gray-500">
            考試日期：{examDate}
          </p>
        </section>

        {/* 今日任務 */}
        <section className="mt-8 rounded-2xl bg-white p-8 shadow">
          <h2 className="text-2xl font-bold">
            🔥 今日任務
          </h2>

          <p className="mt-4 text-xl">
            完成：
            {todayProgress} / {dailyGoal.target} 題
          </p>

          <div className="mt-4 h-4 rounded-full bg-gray-200">
            <div
              className="h-4 rounded-full bg-blue-600"
              style={{
                width: `${Math.min(
                  (todayProgress /
                    dailyGoal.target) *
                    100,
                  100
                )}%`,
              }}
            />
          </div>
        </section>

        {/* 功能 */}
        <section className="mt-10 grid gap-6 md:grid-cols-2">
          <Link
            href="/subjects"
            className="rounded-xl bg-blue-600 p-8 text-white shadow hover:bg-blue-700"
          >
            <h2 className="text-2xl font-bold">
              📖 開始刷題
            </h2>

            <p className="mt-3">
              選擇科目開始練習
            </p>
          </Link>

          <Link
            href="/pdf"
            className="rounded-xl bg-purple-600 p-8 text-white shadow hover:bg-purple-700"
          >
            <h2 className="text-2xl font-bold">
              📄 PDF 自動出題
            </h2>

            <p className="mt-3">
              上傳 PDF，自動建立題目練習
            </p>
          </Link>

          <Link
            href="/favorites"
            className="rounded-xl bg-white p-8 shadow hover:bg-gray-100"
          >
            <h2 className="text-2xl font-bold">
              ⭐ 我的收藏
            </h2>

            <p className="mt-3">
              查看重要題目
            </p>
          </Link>

          <Link
            href="/wrong"
            className="rounded-xl bg-white p-8 shadow hover:bg-gray-100"
          >
            <h2 className="text-2xl font-bold">
              📚 我的錯題本
            </h2>

            <p className="mt-3">
              複習你的弱點題目
            </p>
          </Link>

          <Link
            href="/analysis"
            className="rounded-xl bg-white p-8 shadow hover:bg-gray-100"
          >
            <h2 className="text-2xl font-bold">
              📊 弱點分析
            </h2>

            <p className="mt-3">
              查看你的學習弱點
            </p>
          </Link>
        </section>

        {/* 學習進度 */}
        <h2 className="mt-12 text-3xl font-bold">
          學習進度
        </h2>

        <section className="mt-6 grid gap-6 md:grid-cols-3">
          {subjects.map((subject) => (
            <div
              key={subject}
              className="rounded-xl bg-white p-6 shadow"
            >
              <h3 className="text-xl font-bold">
                {subject}
              </h3>

              <p className="mt-3">
                完成：
                {progress[subject]
                  ? progress[subject].answered.length
                  : 0}
                題
              </p>

              <p className="mt-2">
                正確：
                {progress[subject]
                  ? progress[subject].correct
                  : 0}
                題
              </p>

              <p className="mt-2">
                錯題：
                {progress[subject]
                  ? progress[subject].wrong
                  : 0}
                題
              </p>
            </div>
          ))}
        </section>

      </div>
    </main>
  );
}