"use client";

import Link from "next/link";
import { useState } from "react";

const subjects = [
  "獸醫病理學",
  "獸醫藥理學",
  "獸醫實驗診斷學",
  "獸醫普通疾病學",
  "獸醫傳染病學",
  "獸醫公共衛生學",
];

export default function SubjectsPage() {
  const [order, setOrder] = useState<"original" | "random">("original");

  return (
    <main className="min-h-screen bg-gray-100 p-10">
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-8 text-4xl font-bold">
          📚 選擇科目
        </h1>

        <div className="mb-8 rounded-xl bg-white p-6 shadow">
          <h2 className="text-xl font-bold">
            題目順序
          </h2>

          <p className="mt-2 text-gray-500">
            選擇進入刷題後的題目排列方式。
          </p>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <button
              type="button"
              onClick={() => setOrder("original")}
              className={`rounded-xl border-2 p-5 text-left transition ${
                order === "original"
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-200 hover:bg-gray-50"
              }`}
            >
              <div className="text-lg font-bold">
                🔢 原始順序
              </div>
              <div className="mt-1 text-sm text-gray-500">
                按照題庫原本的題號順序作答。
              </div>
            </button>

            <button
              type="button"
              onClick={() => setOrder("random")}
              className={`rounded-xl border-2 p-5 text-left transition ${
                order === "random"
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-200 hover:bg-gray-50"
              }`}
            >
              <div className="text-lg font-bold">
                🔀 隨機順序
              </div>
              <div className="mt-1 text-sm text-gray-500">
                每次開始測驗時重新打亂題目順序。
              </div>
            </button>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-4">
          {subjects.map((subject) => (
            <Link
              key={subject}
              href={`/questions?subject=${encodeURIComponent(subject)}&order=${order}`}
              className="rounded-xl bg-white p-8 shadow transition hover:bg-blue-600 hover:text-white"
            >
              <h2 className="text-xl font-bold">
                {subject}
              </h2>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
