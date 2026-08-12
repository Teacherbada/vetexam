"use client";

import { useState } from "react";

type ManualQuestion = {
  question: string;
  options: string[];
  answer: string;
  explanation: string;
};

export default function ManualQuestionPage() {
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

  function updateQuestion(index: number, value: string) {
    setQuestions((current) =>
      current.map((item, i) =>
        i === index
          ? { ...item, question: value }
          : item
      )
    );
  }

  function updateOption(
    questionIndex: number,
    optionIndex: number,
    value: string
  ) {
    setQuestions((current) =>
      current.map((item, i) => {
        if (i !== questionIndex) return item;

        const options = [...item.options];
        options[optionIndex] = value;

        return {
          ...item,
          options,
        };
      })
    );
  }

  function updateAnswer(index: number, value: string) {
    setQuestions((current) =>
      current.map((item, i) =>
        i === index
          ? { ...item, answer: value }
          : item
      )
    );
  }

  function updateExplanation(index: number, value: string) {
    setQuestions((current) =>
      current.map((item, i) =>
        i === index
          ? { ...item, explanation: value }
          : item
      )
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

    for (let i = 0; i < questions.length; i++) {
      const item = questions[i];

      if (!item.question.trim()) {
        setMessage(`第 ${i + 1} 題尚未填寫題目。`);
        return;
      }

      const filledOptions = item.options.filter(
        (option) => option.trim() !== ""
      );

      if (filledOptions.length < 2) {
        setMessage(`第 ${i + 1} 題至少需要兩個選項。`);
        return;
      }

      if (
        item.answer &&
        !["A", "B", "C", "D"].includes(
          item.answer.toUpperCase()
        )
      ) {
        setMessage(
          `第 ${i + 1} 題答案只能是 A、B、C、D。`
        );
        return;
      }
    }

    setLoading(true);
    setMessage("正在建立題庫...");

    try {
      const response = await fetch(
        "/api/manual-question-set",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: "手動題庫",
            visibility: "private",
            questions,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail ||
            data.error ||
            "建立題庫失敗"
        );
      }

      setMessage(
        `成功建立題庫，共 ${data.total} 題。`
      );

      if (data.questionSetId) {
        setTimeout(() => {
          window.location.href = `/pdf/questions?setId=${data.questionSetId}`;
        }, 500);
      }
    } catch (error) {
      console.error(error);

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
      <div className="mx-auto max-w-4xl">
        <div className="mb-6">
          <button
            type="button"
            onClick={() => {
              window.location.href = "/pdf";
            }}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 font-semibold text-gray-700 hover:bg-gray-50"
          >
            ← 回 PDF 題庫
          </button>
        </div>

        <div className="rounded-2xl bg-white p-8 shadow">
          <h1 className="text-3xl font-bold text-gray-900">
            手動建立題目
          </h1>

          <p className="mt-2 text-gray-500">
            手動輸入選擇題並建立成題庫。
          </p>

          <div className="mt-8 space-y-6">
            {questions.map((item, questionIndex) => (
              <div
                key={questionIndex}
                className="rounded-2xl border border-gray-200 bg-gray-50 p-6"
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-bold text-gray-900">
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

                <textarea
                  value={item.question}
                  onChange={(event) =>
                    updateQuestion(
                      questionIndex,
                      event.target.value
                    )
                  }
                  rows={4}
                  placeholder="輸入題目內容..."
                  className="mt-4 w-full rounded-lg border border-gray-300 bg-white p-4 text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />

                <div className="mt-5 space-y-3">
                  {item.options.map(
                    (option, optionIndex) => (
                      <div
                        key={optionIndex}
                        className="flex items-center gap-3"
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 font-bold text-blue-700">
                          {String.fromCharCode(
                            65 + optionIndex
                          )}
                        </div>

                        <input
                          type="text"
                          value={option}
                          onChange={(event) =>
                            updateOption(
                              questionIndex,
                              optionIndex,
                              event.target.value
                            )
                          }
                          placeholder={`選項 ${String.fromCharCode(
                            65 + optionIndex
                          )}`}
                          className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        />
                      </div>
                    )
                  )}
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700">
                      正確答案
                    </label>

                    <select
                      value={item.answer}
                      onChange={(event) =>
                        updateAnswer(
                          questionIndex,
                          event.target.value
                        )
                      }
                      className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-gray-900"
                    >
                      <option value="">
                        尚未設定
                      </option>
                      <option value="A">A</option>
                      <option value="B">B</option>
                      <option value="C">C</option>
                      <option value="D">D</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700">
                      解析
                    </label>

                    <textarea
                      value={item.explanation}
                      onChange={(event) =>
                        updateExplanation(
                          questionIndex,
                          event.target.value
                        )
                      }
                      rows={3}
                      placeholder="輸入題目解析..."
                      className="mt-2 w-full rounded-lg border border-gray-300 bg-white p-3 text-gray-900"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={addQuestion}
              className="rounded-lg border border-blue-300 bg-blue-50 px-5 py-3 font-bold text-blue-700 hover:bg-blue-100"
            >
              + 新增一題
            </button>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading}
              className="rounded-lg bg-green-600 px-6 py-3 font-bold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-400"
            >
              {loading ? "建立中..." : "建立題庫"}
            </button>
          </div>

          {message && (
            <div className="mt-5 rounded-lg bg-gray-100 p-4 font-semibold text-gray-800">
              {message}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}