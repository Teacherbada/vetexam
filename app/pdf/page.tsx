"use client";

import { useEffect, useState } from "react";

type ParsedQuestion = {
  id: number;
  subject: string;
  question: string;
  options: string[];
  answer: string;
  explanation: string;
};

type Visibility = "public" | "private";

type QuestionSet = {
  id: number;
  name: string;
  filename: string | null;
  total_questions: number;
  created_at: string;
  file_hash: string | null;
  visibility: Visibility;
};

export default function PDFPage() {
  const [file, setFile] = useState<File | null>(null);
  const [questions, setQuestions] = useState<ParsedQuestion[]>([]);
  const [questionSets, setQuestionSets] = useState<QuestionSet[]>([]);
  const [visibility, setVisibility] =
    useState<Visibility>("private");
  const [loading, setLoading] = useState(false);
  const [loadingQuestionSets, setLoadingQuestionSets] =
    useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadQuestionSets();
  }, []);

  async function loadQuestionSets() {
    try {
      setLoadingQuestionSets(true);

      const response = await fetch(
        "/api/question-sets",
        {
          method: "GET",
          cache: "no-store",
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail ||
            data.error ||
            "無法取得已匯入題庫"
        );
      }

      setQuestionSets(data.questionSets || []);
    } catch (error) {
      console.error("取得題庫失敗：", error);
    } finally {
      setLoadingQuestionSets(false);
    }
  }

  function handleFileChange(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const selectedFile =
      event.target.files?.[0] || null;

    setQuestions([]);
    setMessage("");

    if (!selectedFile) {
      setFile(null);
      return;
    }

    if (selectedFile.type !== "application/pdf") {
      setFile(null);
      setMessage("請選擇 PDF 檔案");
      return;
    }

    const maxSize = 20 * 1024 * 1024;

    if (selectedFile.size > maxSize) {
      setFile(null);
      setMessage("PDF 檔案不能超過 20 MB");
      return;
    }

    setFile(selectedFile);

    setMessage(
      `已選擇 PDF：${selectedFile.name}`
    );
  }

  async function handleUpload() {
    console.log("開始解析按鈕被點擊");

    if (!file) {
      setMessage("請先選擇 PDF 檔案");
      return;
    }

    console.log(
      "準備上傳檔案：",
      file.name
    );
    console.log("檔案大小：", file.size);
    console.log("檔案類型：", file.type);
    console.log("題庫可見性：", visibility);

    setLoading(true);
    setMessage("正在上傳 PDF，請稍候...");
    setQuestions([]);

    try {
      const formData = new FormData();

      formData.append("file", file);
      formData.append("visibility", visibility);

      console.log("開始呼叫 /api/pdf");

      const response = await fetch("/api/pdf", {
        method: "POST",
        body: formData,
      });

      console.log(
        "API 回應狀態：",
        response.status,
        response.statusText
      );

      const responseText =
        await response.text();

      console.log(
        "API HTTP status:",
        response.status
      );

      console.log(
        "API 原始回應:",
        responseText
      );

      let data: any;

      try {
        data = JSON.parse(responseText);
      } catch {
        throw new Error(
          `伺服器沒有正常回傳 JSON（HTTP ${response.status}）。Vercel API 可能發生 Runtime Error。`
        );
      }

      if (!response.ok) {
        throw new Error(
          data.detail ||
            data.error ||
            `PDF 解析失敗（HTTP ${response.status}）`
        );
      }

      const parsedQuestions =
        data.questions || [];

      console.log(
        "成功解析題目：",
        parsedQuestions.length
      );

      if (parsedQuestions.length === 0) {
        setMessage(
          "PDF 有成功送到伺服器，但沒有辨識到題目。"
        );
        return;
      }

      setQuestions(parsedQuestions);

      if (data.duplicate) {
        const visibilityText =
          data.visibility === "public"
            ? "公開題庫"
            : "私人題庫";

        setMessage(
          `這份 PDF 已經匯入過，使用原本的${visibilityText}。共 ${parsedQuestions.length} 題。`
        );
      } else {
        const visibilityText =
          visibility === "public"
            ? "公開題庫"
            : "私人題庫";

        setMessage(
          `成功辨識 ${parsedQuestions.length} 題，已建立${visibilityText}。`
        );
      }

      await loadQuestionSets();
    } catch (error) {
      console.error(
        "PDF 上傳 / 解析錯誤：",
        error
      );

      if (error instanceof Error) {
        setMessage(
          `錯誤：${error.message}`
        );
      } else {
        setMessage(
          "發生未知錯誤，請開啟瀏覽器 Console 查看。"
        );
      }
    } finally {
      setLoading(false);
    }
  }

  function updateQuestion(
    questionId: number,
    value: string
  ) {
    setQuestions((current) =>
      current.map((question) =>
        question.id === questionId
          ? {
              ...question,
              question: value,
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
    setQuestions((current) =>
      current.map((question) => {
        if (question.id !== questionId) {
          return question;
        }

        const newOptions = [
          ...question.options,
        ];

        newOptions[optionIndex] = value;

        return {
          ...question,
          options: newOptions,
        };
      })
    );
  }

  function deleteQuestion(
    questionId: number
  ) {
    setQuestions((current) =>
      current.filter(
        (question) =>
          question.id !== questionId
      )
    );
  }

  function startQuiz() {
    if (questions.length === 0) {
      setMessage("目前沒有可以刷的題目");
      return;
    }

    const invalidQuestion =
      questions.find((question) => {
        if (!question.question.trim()) {
          return true;
        }

        const filledOptions =
          question.options.filter(
            (option) => option.trim() !== ""
          );

        return filledOptions.length < 2;
      });

    if (invalidQuestion) {
      const index =
        questions.indexOf(
          invalidQuestion
        );

      setMessage(
        `第 ${index + 1} 題資料不完整，請先修正。`
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

    window.location.href =
      "/pdf/questions";
  }

  function startSavedQuestionSet(
    questionSetId: number
  ) {
    setMessage(
      `題庫 #${questionSetId} 已選取。下一步將從 Neon 載入題目。`
    );
  }

  function formatDate(
    dateString: string
  ) {
    const date = new Date(dateString);

    return date.toLocaleString(
      "zh-TW",
      {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-4xl font-bold text-blue-900">
          PDF 題庫
        </h1>

        <p className="mt-3 text-gray-600">
          上傳你的考試 PDF，自動辨識選擇題。
        </p>

        <div className="mt-8 rounded-2xl bg-white p-8 shadow">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">
                已匯入題庫
              </h2>

              <p className="mt-2 text-sm text-gray-500">
                已經儲存在 Neon 的題庫，之後不需要重新上傳。
              </p>
            </div>

            <button
              type="button"
              onClick={loadQuestionSets}
              disabled={loadingQuestionSets}
              className="
                rounded-lg
                border
                border-gray-300
                px-4
                py-2
                text-sm
                font-semibold
                text-gray-700
                hover:bg-gray-50
                disabled:cursor-not-allowed
                disabled:opacity-50
              "
            >
              重新整理
            </button>
          </div>

          {loadingQuestionSets ? (
            <div className="mt-6 rounded-xl bg-gray-50 p-6 text-center text-gray-500">
              正在讀取題庫...
            </div>
          ) : questionSets.length === 0 ? (
            <div className="mt-6 rounded-xl bg-gray-50 p-6 text-center text-gray-500">
              目前還沒有匯入任何題庫。
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              {questionSets.map(
                (questionSet) => (
                  <div
                    key={questionSet.id}
                    className="
                      rounded-xl
                      border
                      border-gray-200
                      bg-gray-50
                      p-5
                      transition
                      hover:shadow-md
                    "
                  >
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h3 className="text-xl font-bold text-gray-900">
                          {questionSet.name}
                        </h3>

                        <p className="mt-1 text-sm text-gray-500">
                          {questionSet.filename ||
                            "PDF 題庫"}
                        </p>

                        <div className="mt-3 flex flex-wrap gap-2 text-sm">
                          <span className="rounded-full bg-blue-100 px-3 py-1 font-semibold text-blue-700">
                            {questionSet.total_questions} 題
                          </span>

                          <span
                            className={
                              questionSet.visibility ===
                              "public"
                                ? "rounded-full bg-green-100 px-3 py-1 font-semibold text-green-700"
                                : "rounded-full bg-purple-100 px-3 py-1 font-semibold text-purple-700"
                            }
                          >
                            {questionSet.visibility ===
                            "public"
                              ? "公開題庫"
                              : "私人題庫"}
                          </span>

                          <span className="rounded-full bg-gray-200 px-3 py-1 text-gray-700">
                            匯入於{" "}
                            {formatDate(
                              questionSet.created_at
                            )}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          startSavedQuestionSet(
                            questionSet.id
                          )
                        }
                        className="
                          shrink-0
                          rounded-lg
                          bg-green-600
                          px-5
                          py-3
                          font-bold
                          text-white
                          hover:bg-green-700
                        "
                      >
                        開始刷題
                      </button>
                    </div>
                  </div>
                )
              )}
            </div>
          )}
        </div>

        <div className="mt-8 rounded-2xl bg-white p-8 shadow">
          <h2 className="text-2xl font-bold text-gray-900">
            ① 上傳 PDF
          </h2>

          <p className="mt-2 text-sm text-gray-500">
            目前支援 PDF 內含文字的檔案，最大 20 MB。
          </p>

          <input
            type="file"
            accept=".pdf,application/pdf"
            onChange={handleFileChange}
            className="
              mt-6
              w-full
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
                {file.name}
              </p>

              <p className="mt-1 text-sm text-blue-700">
                檔案大小：
                {(
                  file.size /
                  1024 /
                  1024
                ).toFixed(2)}{" "}
                MB
              </p>
            </div>
          )}

          <div className="mt-6">
            <h3 className="text-lg font-bold text-gray-900">
              題庫可見範圍
            </h3>

            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <button
                type="button"
                onClick={() =>
                  setVisibility("public")
                }
                className={`rounded-xl border-2 p-5 text-left transition ${
                  visibility === "public"
                    ? "border-green-500 bg-green-50"
                    : "border-gray-200 bg-white hover:border-gray-300"
                }`}
              >
                <div className="text-lg font-bold text-gray-900">
                  公開國考題庫
                </div>

                <p className="mt-2 text-sm text-gray-600">
                  所有使用者都可以看到這個題庫。
                </p>
              </button>

              <button
                type="button"
                onClick={() =>
                  setVisibility("private")
                }
                className={`rounded-xl border-2 p-5 text-left transition ${
                  visibility === "private"
                    ? "border-purple-500 bg-purple-50"
                    : "border-gray-200 bg-white hover:border-gray-300"
                }`}
              >
                <div className="text-lg font-bold text-gray-900">
                  私人題庫
                </div>

                <p className="mt-2 text-sm text-gray-600">
                  只有自己可以使用這個題庫。
                </p>
              </button>
            </div>

            <p className="mt-3 text-sm text-gray-500">
              建議只有在確認 PDF 內容可以公開分享時，才選擇公開題庫。
            </p>
          </div>

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
              ? "正在解析 PDF..."
              : "開始解析"}
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

        {questions.length > 0 && (
          <div className="mt-8">
            <div className="mb-5 rounded-2xl bg-white p-6 shadow">
              <div
                className="
                  flex
                  flex-col
                  gap-4
                  md:flex-row
                  md:items-center
                  md:justify-between
                "
              >
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">
                    ② 確認辨識結果
                  </h2>

                  <p className="mt-2 text-gray-600">
                    共辨識到{" "}
                    <span className="font-bold text-blue-600">
                      {questions.length}
                    </span>{" "}
                    題。
                  </p>
                </div>

                <button
                  type="button"
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
                  確認並開始刷題
                </button>
              </div>
            </div>

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
                    <div className="flex items-center justify-between">
                      <p className="font-bold text-blue-600">
                        第 {index + 1} 題
                      </p>

                      <button
                        type="button"
                        onClick={() =>
                          deleteQuestion(
                            question.id
                          )
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
                        刪除
                      </button>
                    </div>

                    <div className="mt-4">
                      <label className="text-sm font-semibold text-gray-600">
                        題目
                      </label>

                      <textarea
                        value={question.question}
                        onChange={(event) =>
                          updateQuestion(
                            question.id,
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

                    <div className="mt-5">
                      <label className="text-sm font-semibold text-gray-600">
                        選項
                      </label>

                      <div className="mt-2 space-y-3">
                        {question.options.map(
                          (
                            option,
                            optionIndex
                          ) => (
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
                                  65 +
                                    optionIndex
                                )}
                              </div>

                              <textarea
                                value={option}
                                onChange={(event) =>
                                  updateOption(
                                    question.id,
                                    optionIndex,
                                    event.target
                                      .value
                                  )
                                }
                                rows={2}
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
          </div>
        )}
      </div>
    </main>
  );
}