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
  const [deletedQuestions, setDeletedQuestions] = useState<
    ParsedQuestion[]
  >([]);

  function handleFileChange(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const selectedFile = event.target.files?.[0] || null;

    setFile(selectedFile);
    setQuestions([]);
    setDeletedQuestions([]);
    setMessage("");

    if (!selectedFile) {
      return;
    }

    if (selectedFile.type !== "application/pdf") {
      setFile(null);
      setMessage("❌ 請選擇 PDF 檔案");
      return;
    }

    const maxSize = 20 * 1024 * 1024;

    if (selectedFile.size > maxSize) {
      setFile(null);
      setMessage("❌ PDF 檔案不能超過 20 MB");
      return;
    }
  }

  async function handleUpload() {
    if (!file) {
      setMessage("❌ 請先選擇 PDF");
      return;
    }

    setLoading(true);
    setMessage("");
    setQuestions([]);
    setDeletedQuestions([]);

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

      const parsedQuestions: ParsedQuestion[] =
        data.questions || [];

      if (parsedQuestions.length === 0) {
        setMessage(
          "⚠️ 沒有辨識到選擇題。請確認 PDF 是文字型 PDF，且題目格式可以辨識。"
        );
        return;
      }

      setQuestions(parsedQuestions);

      setMessage(
        `✅ 成功辨識 ${parsedQuestions.length} 題，請確認題目內容。`
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `❌ ${error.message}`
          : "❌ 發生未知錯誤"
      );
    } finally {
      setLoading(false);
    }
  }

  function updateQuestion(
    questionId: number,
    field: "question",
    value: string
  ) {
    setQuestions((currentQuestions) =>
      currentQuestions.map((question) =>
        question.id === questionId
          ? {
              ...question,
              [field]: value,
            }
          : question
      )
    );
  }

  function updateOption(
    questionId: number,
    optionIndex: number,
    value: string
  ) {
    setQuestions((currentQuestions) =>
      currentQuestions.map((question) => {
        if (question.id !== questionId) {
          return question;
        }

        const newOptions = [...question.options];

        newOptions[optionIndex] = value;

        return {
          ...question,
          options: newOptions,
        };
      })
    );
  }

  function deleteQuestion(questionId: number) {
    const question = questions.find(
      (item) => item.id === questionId
    );

    if (!question) {
      return;
    }

    setDeletedQuestions((current) => [
      ...current,
      question,
    ]);

    setQuestions((currentQuestions) =>
      currentQuestions.filter(
        (item) => item.id !== questionId
      )
    );
  }

  function restoreQuestion(questionId: number) {
    const question = deletedQuestions.find(
      (item) => item.id === questionId
    );

    if (!question) {
      return;
    }

    setQuestions((current) => [...current, question]);

    setDeletedQuestions((current) =>
      current.filter(
        (item) => item.id !== questionId
      )
    );
  }

  function startQuiz() {
    if (questions.length === 0) {
      setMessage("❌ 目前沒有可以刷的題目");
      return;
    }

    const invalidQuestion = questions.find(
      (question) => {
        if (!question.question.trim()) {
          return true;
        }

        const filledOptions =
          question.options.filter(
            (option) => option.trim()
          );

        return filledOptions.length < 2;
      }
    );

    if (invalidQuestion) {
      setMessage(
        `❌ 第 ${questions.indexOf(invalidQuestion) + 1} 題資料不完整，請先修正。`
      );
      return;
    }

    localStorage.setItem(
      "pdfQuestions",
      JSON.stringify(questions)
    );

    localStorage.setItem(
      "pdfQuestionSource",
      file?.name || "PDF 題庫"
    );

    window.location.href = "/pdf/questions";
  }

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto max-w-5xl">

        {/* 標題 */}
        <div>
          <h1 className="text-4xl font-bold text-blue-900">
            📄 PDF 題庫
          </h1>

          <p className="mt-3 text-gray-600">
            上傳你的考試 PDF，自動辨識選擇題。
          </p>
        </div>

        {/* 上傳區 */}
        <div className="mt-8 rounded-2xl bg-white p-8 shadow">

          <h2 className="text-2xl font-bold text-gray-900">
            ① 上傳 PDF
          </h2>

          <p className="mt-2 text-sm text-gray-500">
            目前支援 PDF 內含文字的檔案，單一檔案最大 20 MB。
          </p>

          <input
            type="file"
            accept=".pdf,application/pdf"
            onChange={handleFileChange}
            className="
              mt-6
              w-full
              cursor-pointer
              rounded-lg
              border
              border-gray-300
              bg-white
              p-3
              text-gray-700
            "
          />

          {file && (
            <div className="mt-4 rounded-lg bg-blue-50 p-4">
              <p className="font-semibold text-blue-900">
                📄 {file.name}
              </p>

              <p className="mt-1 text-sm text-blue-700">
                檔案大小：
                {(file.size / 1024 / 1024).toFixed(2)}
                {" MB"}
              </p>
            </div>
          )}

          <button
  type="button"
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
    transition
    hover:bg-blue-700
    disabled:cursor-not-allowed
    disabled:bg-gray-400
  "
>
  {loading
    ? "🔍 正在解析 PDF..."
    : "📖 開始解析"}
</button>

          {message && (
            <div
              className="
                mt-5
                rounded-lg
                bg-gray-100
                p-4
                font-semibold
                text-gray-800
              "
            >
              {message}
            </div>
          )}
        </div>

        {/* 辨識結果 */}
        {questions.length > 0 && (
          <div className="mt-8">

            <div className="mb-5 rounded-2xl bg-white p-6 shadow">

              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">

                <div>
                  <h2 className="text-2xl font-bold text-gray-900">
                    ② 確認辨識結果
                  </h2>

                  <p className="mt-2 text-gray-600">
                    共辨識到{" "}
                    <span className="font-bold text-blue-600">
                      {questions.length}
                    </span>
                    {" "}題。
                    可以直接修改錯誤的題目。
                  </p>
                </div>

                <button
                  onClick={startQuiz}
                  className="
                    rounded-lg
                    bg-green-600
                    px-6
                    py-3
                    font-bold
                    text-white
                    transition
                    hover:bg-green-700
                  "
                >
                  🎯 確認並開始刷題
                </button>

              </div>
            </div>

            {/* 題目 */}
            <div className="space-y-6">

              {questions.map(
                (question, index) => (
                  <div
                    key={`${question.id}-${index}`}
                    className="
                      rounded-2xl
                      bg-white
                      p-6
                      shadow
                    "
                  >

                    {/* 題號 */}
                    <div className="flex items-center justify-between">

                      <p className="font-bold text-blue-600">
                        第 {index + 1} 題
                      </p>

                      <button
                        onClick={() =>
                          deleteQuestion(question.id)
                        }
                        className="
                          rounded-lg
                          px-3
                          py-2
                          text-sm
                          font-semibold
                          text-red-600
                          hover:bg-red-50
                        "
                      >
                        🗑️ 刪除
                      </button>

                    </div>

                    {/* 題目 */}
                    <div className="mt-4">

                      <label className="text-sm font-semibold text-gray-600">
                        題目
                      </label>

                      <textarea
                        value={question.question}
                        onChange={(event) =>
                          updateQuestion(
                            question.id,
                            "question",
                            event.target.value
                          )
                        }
                        rows={4}
                        className="
                          mt-2
                          w-full
                          rounded-lg
                          border
                          border-gray-300
                          p-4
                          text-lg
                          font-semibold
                          text-gray-900
                          outline-none
                          focus:border-blue-500
                          focus:ring-2
                          focus:ring-blue-100
                        "
                      />

                    </div>

                    {/* 選項 */}
                    <div className="mt-5">

                      <label className="text-sm font-semibold text-gray-600">
                        選項
                      </label>

                      <div className="mt-2 space-y-3">

                        {question.options.map(
                          (option, optionIndex) => (
                            <div
                              key={optionIndex}
                              className="flex items-start gap-3"
                            >

                              <div
                                className="
                                  mt-3
                                  flex
                                  h-8
                                  w-8
                                  shrink-0
                                  items-center
                                  justify-center
                                  rounded-full
                                  bg-blue-100
                                  font-bold
                                  text-blue-700
                                "
                              >
                                {String.fromCharCode(
                                  65 + optionIndex
                                )}
                              </div>

                              <textarea
                                value={option}
                                onChange={(event) =>
                                  updateOption(
                                    question.id,
                                    optionIndex,
                                    event.target.value
                                  )
                                }
                                rows={2}
                                placeholder={`選項 ${String.fromCharCode(
                                  65 + optionIndex
                                )}`}
                                className="
                                  w-full
                                  rounded-lg
                                  border
                                  border-gray-300
                                  p-3
                                  text-gray-900
                                  outline-none
                                  focus:border-blue-500
                                  focus:ring-2
                                  focus:ring-blue-100
                                "
                              />

                            </div>
                          )
                        )}

                      </div>
                    </div>

                  </div>
                )
              )}

            </div>

            {/* 底部確認 */}
            <div className="mt-8 rounded-2xl bg-white p-6 shadow">

              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">

                <div>
                  <p className="font-bold text-gray-900">
                    題目確認完成了嗎？
                  </p>

                  <p className="mt-1 text-sm text-gray-500">
                    確認後會將目前題目暫存到瀏覽器，並進入刷題頁面。
                  </p>
                </div>

                <button
                  onClick={startQuiz}
                  className="
                    rounded-lg
                    bg-green-600
                    px-8
                    py-3
                    font-bold
                    text-white
                    transition
                    hover:bg-green-700
                  "
                >
                  🎯 開始刷題
                </button>

              </div>

            </div>

          </div>
        )}

        {/* 已刪除題目 */}
        {deletedQuestions.length > 0 && (
          <div className="mt-8 rounded-2xl bg-white p-6 shadow">

            <h2 className="text-xl font-bold text-gray-900">
              🗑️ 已刪除題目
            </h2>

            <p className="mt-2 text-sm text-gray-500">
              如果誤刪，可以在這裡恢復。
            </p>

            <div className="mt-4 space-y-3">

              {deletedQuestions.map(
                (question) => (
                  <div
                    key={question.id}
                    className="
                      flex
                      items-center
                      justify-between
                      rounded-lg
                      bg-gray-50
                      p-4
                    "
                  >

                    <div className="min-w-0 pr-4">
                      <p className="font-semibold text-gray-800">
                        第 {question.id} 題
                      </p>

                      <p className="truncate text-sm text-gray-500">
                        {question.question}
                      </p>
                    </div>

                    <button
                      onClick={() =>
                        restoreQuestion(question.id)
                      }
                      className="
                        shrink-0
                        rounded-lg
                        bg-blue-600
                        px-4
                        py-2
                        text-sm
                        font-semibold
                        text-white
                        hover:bg-blue-700
                      "
                    >
                      ↩️ 恢復
                    </button>

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