"use client";

import { useState } from "react";

const EXAM_SUBJECTS = [
  "解剖學",
  "生理學",
  "生物化學",
  "藥理學",
  "病理學",
  "微生物學",
  "寄生蟲學",
  "免疫學",
  "內科學",
  "外科學",
  "繁殖學",
  "公共衛生學",
  "其他",
];

const EXAM_YEARS = Array.from(
  { length: 10 },
  (_, index) => new Date().getFullYear() - index
);

type ManualQuestion = {
  question: string;
  options: string[];
  answer: string;
  explanation: string;
};

export default function ManualPage() {
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [year, setYear] = useState<number | "">("");
  const [visibility, setVisibility] = useState<"public" | "private">(
    "public"
  );

  const [questions, setQuestions] = useState<ManualQuestion[]>([
    {
      question: "",
      options: ["", "", "", ""],
      answer: "",
      explanation: "",
    },
  ]);

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  function updateQuestion(
    index: number,
    field: keyof ManualQuestion,
    value: string
  ) {
    setQuestions((current) =>
      current.map((question, i) =>
        i === index
          ? {
              ...question,
              [field]: value,
            }
          : question
      )
    );
  }

  function updateOption(
    questionIndex: number,
    optionIndex: number,
    value: string
  ) {
    setQuestions((current) =>
      current.map((question, i) => {
        if (i !== questionIndex) return question;

        const options = [...question.options];
        options[optionIndex] = value;

        return {
          ...question,
          options,
        };
      })
    );
  }

  function addQuestion() {
    setQuestions((current) => [
      ...current,
      {
        question: "",
        options: ["", "", "", ""],
        answer: "",
        explanation: "",
      },
    ]);
  }

  function removeQuestion(index: number) {
    if (questions.length === 1) return;

    setQuestions((current) =>
      current.filter((_, i) => i !== index)
    );
  }

  async function handleSubmit() {
    setMessage("");

    if (!name.trim()) {
      setMessage("請輸入題庫名稱");
      return;
    }

    if (!subject) {
      setMessage("請選擇國考科目");
      return;
    }

    if (!year) {
      setMessage("請選擇國考年份");
      return;
    }

    if (questions.length === 0) {
      setMessage("至少需要一題");
      return;
    }

    for (let i = 0; i < questions.length; i++) {
      const question = questions[i];

      if (!question.question.trim()) {
        setMessage(`第 ${i + 1} 題沒有題目`);
        return;
      }

      if (question.options.some((option) => !option.trim())) {
        setMessage(`第 ${i + 1} 題的 A～D 選項必須全部填寫`);
        return;
      }

      if (!question.answer) {
        setMessage(`第 ${i + 1} 題尚未選擇正確答案`);
        return;
      }
    }

    setLoading(true);
    setMessage("正在儲存題庫...");

    try {
      const response = await fetch("/api/manual-question-set", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          subject,
          year,
          visibility,
          questions,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail || data.error || "建立題庫失敗"
        );
      }

      setMessage(
        `成功建立題庫，共 ${data.total || questions.length} 題。`
      );

      setQuestions([
        {
          question: "",
          options: ["", "", "", ""],
          answer: "",
          explanation: "",
        },
      ]);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "建立題庫失敗"
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6">
          <button
            type="button"
            onClick={() => {
              window.location.href = "/pdf";
            }}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 font-semibold text-gray-700 hover:bg-gray-50"
          >
            ← 回題庫
          </button>
        </div>

        <h1 className="text-4xl font-bold text-blue-900">
          手動建立題庫
        </h1>

        <p className="mt-3 text-gray-600">
          不需要 PDF，也可以直接建立國考題目。
        </p>

        <div className="mt-8 rounded-2xl bg-white p-8 shadow">
          <h2 className="text-2xl font-bold text-gray-900">
            題庫資料
          </h2>

          <div className="mt-6 grid gap-5 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="block text-sm font-semibold text-gray-700">
                題庫名稱
              </label>

              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：113 年獸醫師國考 解剖學"
                className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-900"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700">
                國考科目
              </label>

              <select
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-gray-900"
              >
                <option value="">請選擇科目</option>

                {EXAM_SUBJECTS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700">
                國考年份
              </label>

              <select
                value={year}
                onChange={(e) =>
                  setYear(
                    e.target.value
                      ? Number(e.target.value)
                      : ""
                  )
                }
                className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-gray-900"
              >
                <option value="">請選擇年份</option>

                {EXAM_YEARS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-6">
            <label className="block text-sm font-semibold text-gray-700">
              題庫類型
            </label>

            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <button
                type="button"
                onClick={() => setVisibility("public")}
                className={`rounded-xl border-2 p-5 text-left ${
                  visibility === "public"
                    ? "border-green-500 bg-green-50"
                    : "border-gray-200"
                }`}
              >
                <div className="font-bold text-gray-900">
                  公開國考題庫
                </div>

                <p className="mt-2 text-sm text-gray-600">
                  作為 VetExam 的基本國考題庫。
                </p>
              </button>

              <button
                type="button"
                onClick={() => setVisibility("private")}
                className={`rounded-xl border-2 p-5 text-left ${
                  visibility === "private"
                    ? "border-purple-500 bg-purple-50"
                    : "border-gray-200"
                }`}
              >
                <div className="font-bold text-gray-900">
                  私人題庫
                </div>

                <p className="mt-2 text-sm text-gray-600">
                  僅自己可以使用。
                </p>
              </button>
            </div>
          </div>
        </div>

        <div className="mt-8 space-y-6">
          {questions.map((question, questionIndex) => (
            <div
              key={questionIndex}
              className="rounded-2xl bg-white p-8 shadow"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-blue-900">
                  第 {questionIndex + 1} 題
                </h2>

                {questions.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      removeQuestion(questionIndex)
                    }
                    className="rounded-lg px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
                  >
                    刪除
                  </button>
                )}
              </div>

              <label className="mt-5 block text-sm font-semibold text-gray-700">
                題目
              </label>

              <textarea
                value={question.question}
                onChange={(e) =>
                  updateQuestion(
                    questionIndex,
                    "question",
                    e.target.value
                  )
                }
                rows={4}
                placeholder="輸入題目..."
                className="mt-2 w-full rounded-lg border border-gray-300 p-4 text-gray-900"
              />

              <div className="mt-5">
                <label className="text-sm font-semibold text-gray-700">
                  選項
                </label>

                <div className="mt-3 space-y-3">
                  {question.options.map(
                    (option, optionIndex) => (
                      <div
                        key={optionIndex}
                        className="flex items-center gap-3"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 font-bold text-blue-700">
                          {String.fromCharCode(
                            65 + optionIndex
                          )}
                        </span>

                        <input
                          value={option}
                          onChange={(e) =>
                            updateOption(
                              questionIndex,
                              optionIndex,
                              e.target.value
                            )
                          }
                          placeholder={`選項 ${String.fromCharCode(
                            65 + optionIndex
                          )}`}
                          className="w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-900"
                        />
                      </div>
                    )
                  )}
                </div>
              </div>

              <div className="mt-5">
                <label className="block text-sm font-semibold text-gray-700">
                  正確答案
                </label>

                <select
                  value={question.answer}
                  onChange={(e) =>
                    updateQuestion(
                      questionIndex,
                      "answer",
                      e.target.value
                    )
                  }
                  className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-gray-900"
                >
                  <option value="">請選擇答案</option>
                  <option value="A">A</option>
                  <option value="B">B</option>
                  <option value="C">C</option>
                  <option value="D">D</option>
                </select>
              </div>

              <div className="mt-5">
                <label className="block text-sm font-semibold text-gray-700">
                  詳解
                </label>

                <textarea
                  value={question.explanation}
                  onChange={(e) =>
                    updateQuestion(
                      questionIndex,
                      "explanation",
                      e.target.value
                    )
                  }
                  rows={4}
                  placeholder="輸入詳解（可留空）"
                  className="mt-2 w-full rounded-lg border border-gray-300 p-4 text-gray-900"
                />
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap gap-4">
          <button
            type="button"
            onClick={addQuestion}
            className="rounded-lg border border-blue-300 bg-white px-6 py-3 font-bold text-blue-700 hover:bg-blue-50"
          >
            + 新增一題
          </button>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading}
            className="rounded-lg bg-green-600 px-8 py-3 font-bold text-white hover:bg-green-700 disabled:bg-gray-400"
          >
            {loading ? "正在儲存..." : "儲存整份題庫"}
          </button>
        </div>

        {message && (
          <div className="mt-5 rounded-xl bg-gray-100 p-4 font-semibold text-gray-800">
            {message}
          </div>
        )}
      </div>
    </main>
  );
}