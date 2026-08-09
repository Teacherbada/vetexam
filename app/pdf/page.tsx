"use client";

import { useState } from "react";

type ParsedQuestion = {
  id: number;
  subject: string;
  question: string;
  options: string[];
  answer: string;
  explanation: string;
};

export default function PDFPage() {
  const [file, setFile] = useState<File | null>(null);
  const [questions, setQuestions] = useState<ParsedQuestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function handleUpload() {
    if (!file) {
      alert("請先選擇 PDF");
      return;
    }

    setLoading(true);
    setMessage("");
    setQuestions([]);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/pdf", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "PDF 解析失敗"
        );
      }

      setQuestions(data.questions);

      setMessage(
        `成功辨識 ${data.questions.length} 題`
      );
    } catch (error: any) {
      setMessage(
        error.message || "發生未知錯誤"
      );
    } finally {
      setLoading(false);
    }
  }

  function startQuiz() {
    localStorage.setItem(
      "pdfQuestions",
      JSON.stringify(questions)
    );

    window.location.href =
      "/pdf/questions";
  }

  return (
    <main className="min-h-screen bg-gray-100 p-10">

      <div className="mx-auto max-w-5xl">

        <h1 className="text-4xl font-bold text-blue-900">
          📄 PDF 題庫
        </h1>

        <p className="mt-3 text-gray-600">
          上傳你的考試 PDF，自動辨識選擇題。
        </p>

        <div className="mt-8 rounded-2xl bg-white p-8 shadow">

          <input
            type="file"
            accept=".pdf"
            onChange={(e) => {
              setFile(
                e.target.files?.[0] || null
              );
            }}
            className="w-full rounded-lg border p-3"
          />

          {file && (
            <p className="mt-4 text-gray-600">
              已選擇：
              {file.name}
            </p>
          )}

          <button
            onClick={handleUpload}
            disabled={loading}
            className="
              mt-6
              rounded-lg
              bg-blue-600
              px-6
              py-3
              font-bold
              text-white
              hover:bg-blue-700
              disabled:bg-gray-400
            "
          >
            {loading
              ? "🔍 正在解析 PDF..."
              : "📖 開始解析"}
          </button>

          {message && (
            <p className="mt-5 font-bold">
              {message}
            </p>
          )}

        </div>

        {questions.length > 0 && (
          <div className="mt-8">

            <div className="mb-5 flex items-center justify-between">

              <h2 className="text-2xl font-bold">
                辨識結果
              </h2>

              <button
                onClick={startQuiz}
                className="
                  rounded-lg
                  bg-green-600
                  px-6
                  py-3
                  font-bold
                  text-white
                  hover:bg-green-700
                "
              >
                🎯 開始刷題
              </button>

            </div>

            <div className="space-y-5">

              {questions.map(
                (question, index) => (
                  <div
                    key={question.id}
                    className="
                      rounded-xl
                      bg-white
                      p-6
                      shadow
                    "
                  >

                    <p className="font-bold text-blue-600">
                      第 {index + 1} 題
                    </p>

                    <h3 className="mt-3 text-xl font-bold">
                      {question.question}
                    </h3>

                    <div className="mt-4 space-y-2">

                      {question.options.map(
                        (option, optionIndex) => (
                          <p key={optionIndex}>
                            {String.fromCharCode(
                              65 + optionIndex
                            )}
                            . {option}
                          </p>
                        )
                      )}

                    </div>

                  </div>
                )
              )}

            </div>

          </div>
        )}

      </div>

    </main>
  );
}