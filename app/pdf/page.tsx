"use client";

import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";

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
  exam_subject: string | null;
  exam_year: number | null;
};

type ManualQuestion = {
  question: string;
  options: string[];
  answer: string;
  explanation: string;
};

const EXAM_SUBJECTS = [
  "獸醫病理學",
  "獸醫藥理學",
  "獸醫實驗診斷學",
  "獸醫普通疾病學",
  "獸醫傳染病學",
  "獸醫公共衛生學",
];

const EXAM_YEARS = Array.from(
  { length: 10 },
  (_, index) => new Date().getFullYear() - index
);

export default function PDFPage() {
  const {
    data: session,
    isPending: sessionLoading,
    refetch: refetchSession,
  } = authClient.useSession();

  const [subscription, setSubscription] = useState<{
    plan: string;
    status: string;
  } | null>(null);

  const [subscriptionLoading, setSubscriptionLoading] = useState(true);

  const [file, setFile] = useState<File | null>(null);

  const [questions, setQuestions] = useState<ParsedQuestion[]>([]);

  const [importMode, setImportMode] = useState<"pdf" | "manual">("pdf");

  const [manualSetName, setManualSetName] = useState("");

  const [manualQuestions, setManualQuestions] = useState<ManualQuestion[]>([
    {
      question: "",
      options: ["", "", "", ""],
      answer: "",
      explanation: "",
    },
  ]);

  const [manualLoading, setManualLoading] = useState(false);

  const [manualMessage, setManualMessage] = useState("");

  const [questionSets, setQuestionSets] = useState<QuestionSet[]>([]);

  const [currentQuestionSetId, setCurrentQuestionSetId] = useState<
    number | null
  >(null);

  const [examSubject, setExamSubject] = useState("");

  const [examYear, setExamYear] = useState<number | "">("");

  const [loading, setLoading] = useState(false);

  const [loadingQuestionSets, setLoadingQuestionSets] = useState(true);

  const [message, setMessage] = useState("");

  const [upgradeRequired, setUpgradeRequired] = useState(false);

  const isLoggedIn = !!session?.user;

  const isPro =
    subscription?.plan === "pro" &&
    subscription?.status === "active";

  useEffect(() => {
    if (!sessionLoading) {
      loadQuestionSets();
      loadSubscription();
    }
  }, [sessionLoading, session?.user?.id]);

  async function loadSubscription() {
    if (!session?.user?.id) {
      setSubscription(null);
      setSubscriptionLoading(false);
      return;
    }

    try {
      setSubscriptionLoading(true);

      const response = await fetch("/api/subscription", {
        method: "GET",
        cache: "no-store",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail ||
            data.error ||
            "無法取得會員方案"
        );
      }

      setSubscription(data.subscription || null);
    } catch (error) {
      console.error("取得會員方案失敗：", error);
      setSubscription(null);
    } finally {
      setSubscriptionLoading(false);
    }
  }

  async function loadQuestionSets() {
    try {
      setLoadingQuestionSets(true);

      const response = await fetch("/api/question-sets", {
        method: "GET",
        cache: "no-store",
      });

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

  async function handleLogout() {
    try {
      await authClient.signOut();
      await refetchSession();

      setSubscription(null);

      window.location.href = "/";
    } catch (error) {
      console.error("登出失敗：", error);
    }
  }

  function handleFileChange(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const selectedFile =
      event.target.files?.[0] || null;

    setQuestions([]);
    setCurrentQuestionSetId(null);
    setMessage("");
    setUpgradeRequired(false);

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

  function addManualQuestion() {
    setManualQuestions((current) => [
      ...current,
      {
        question: "",
        options: ["", "", "", ""],
        answer: "",
        explanation: "",
      },
    ]);
  }

  function removeManualQuestion(index: number) {
    setManualQuestions((current) =>
      current.filter(
        (_, questionIndex) =>
          questionIndex !== index
      )
    );
  }

  function updateManualQuestion(
    index: number,
    value: string
  ) {
    setManualQuestions((current) =>
      current.map((question, questionIndex) =>
        questionIndex === index
          ? {
              ...question,
              question: value,
            }
          : question
      )
    );
  }

  function updateManualOption(
    questionIndex: number,
    optionIndex: number,
    value: string
  ) {
    setManualQuestions((current) =>
      current.map((question, index) => {
        if (index !== questionIndex) {
          return question;
        }

        const options = [...question.options];

        options[optionIndex] = value;

        return {
          ...question,
          options,
        };
      })
    );
  }

  function updateManualAnswer(
    index: number,
    value: string
  ) {
    setManualQuestions((current) =>
      current.map((question, questionIndex) =>
        questionIndex === index
          ? {
              ...question,
              answer: value,
            }
          : question
      )
    );
  }

  function updateManualExplanation(
    index: number,
    value: string
  ) {
    setManualQuestions((current) =>
      current.map((question, questionIndex) =>
        questionIndex === index
          ? {
              ...question,
              explanation: value,
            }
          : question
      )
    );
  }

  async function handleManualImport() {
    setManualMessage("");

    if (!isLoggedIn) {
      setManualMessage(
        "請先登入後再使用手動匯入功能。"
      );
      return;
    }

    if (!manualQuestions.length) {
      setManualMessage("至少需要建立一題。");
      return;
    }

    for (
      let index = 0;
      index < manualQuestions.length;
      index++
    ) {
      const question = manualQuestions[index];

      if (!question.question.trim()) {
        setManualMessage(
          `第 ${index + 1} 題還沒有填寫題目。`
        );
        return;
      }

      const filledOptions =
        question.options.filter(
          (option) => option.trim() !== ""
        );

      if (filledOptions.length < 2) {
        setManualMessage(
          `第 ${index + 1} 題至少需要兩個選項。`
        );
        return;
      }

      if (
        question.answer &&
        !["A", "B", "C", "D"].includes(
          question.answer.toUpperCase()
        )
      ) {
        setManualMessage(
          `第 ${index + 1} 題答案只能是 A、B、C、D。`
        );
        return;
      }
    }

    setManualLoading(true);
    setManualMessage("正在建立私人題庫...");

    try {
      const response = await fetch(
        "/api/manual-question-set",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: manualSetName,
            visibility: "private",
            examSubject,
            examYear,
            questions: manualQuestions,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        if (
          response.status === 403 ||
          data.code === "PRO_REQUIRED"
        ) {
          setManualMessage(
            "手動匯入功能需要 PRO 會員。"
          );
          return;
        }

        if (response.status === 401) {
          setManualMessage(
            "請先登入後再使用手動匯入功能。"
          );
          return;
        }

        throw new Error(
          data.detail ||
            data.error ||
            "手動匯入失敗"
        );
      }

      setManualMessage(
        `成功匯入 ${data.total} 題！私人題庫已永久保存。`
      );

      setManualQuestions([
        {
          question: "",
          options: ["", "", "", ""],
          answer: "",
          explanation: "",
        },
      ]);

      setManualSetName("");

      await loadQuestionSets();
    } catch (error) {
      console.error("手動匯入失敗：", error);

      setManualMessage(
        error instanceof Error
          ? `錯誤：${error.message}`
          : "手動匯入失敗。"
      );
    } finally {
      setManualLoading(false);
    }
  }

  async function handleUpload() {
    setUpgradeRequired(false);

    if (!isLoggedIn) {
      setMessage(
        "請先登入後再使用 PDF 匯入功能。"
      );
      return;
    }

    if (!file) {
      setMessage("請先選擇 PDF 檔案");
      return;
    }

    setLoading(true);
    setMessage(
      "正在上傳 PDF，請稍候..."
    );
    setQuestions([]);
    setCurrentQuestionSetId(null);

    try {
      const formData = new FormData();

      formData.append("file", file);
      formData.append("visibility", "private");

      if (examSubject) {
        formData.append(
          "examSubject",
          examSubject
        );
      }

      if (examYear) {
        formData.append(
          "examYear",
          String(examYear)
        );
      }

      const response = await fetch(
        "/api/pdf",
        {
          method: "POST",
          body: formData,
        }
      );

      const responseText =
        await response.text();

      let data: any;

      try {
        data = JSON.parse(responseText);
      } catch {
        throw new Error(
          `伺服器沒有正常回傳 JSON（HTTP ${response.status}）。`
        );
      }

      if (!response.ok) {
        if (
          response.status === 403 ||
          data.code === "PRO_REQUIRED"
        ) {
          setUpgradeRequired(true);
          setMessage(
            "此功能需要 PRO 會員才能使用。"
          );
          return;
        }

        if (response.status === 401) {
          setMessage(
            "請先登入後再使用 PDF 匯入功能。"
          );
          return;
        }

        throw new Error(
          data.detail ||
            data.error ||
            `PDF 解析失敗（HTTP ${response.status}）`
        );
      }

      const parsedQuestions =
        data.questions || [];

      if (parsedQuestions.length === 0) {
        setMessage(
          "PDF 有成功送到伺服器，但沒有辨識到題目。"
        );
        return;
      }

      if (data.questionSetId) {
        setCurrentQuestionSetId(
          Number(data.questionSetId)
        );
      }

      setQuestions(parsedQuestions);

      if (data.duplicate) {
        setMessage(
          `這份 PDF 已經匯入過，使用原本的私人題庫。共 ${parsedQuestions.length} 題。`
        );
      } else {
        setMessage(
          `成功辨識 ${parsedQuestions.length} 題，已建立私人題庫。`
        );
      }

      await loadQuestionSets();
    } catch (error) {
      console.error(
        "PDF 上傳 / 解析錯誤：",
        error
      );

      setMessage(
        error instanceof Error
          ? `錯誤：${error.message}`
          : "發生未知錯誤。"
      );
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
      setMessage(
        "目前沒有可以刷的題目"
      );
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

    if (!currentQuestionSetId) {
      setMessage(
        "找不到題庫 ID，請重新匯入這份 PDF。"
      );
      return;
    }

    window.location.href =
      `/pdf/questions?setId=${encodeURIComponent(
        currentQuestionSetId
      )}`;
  }

  function startSavedQuestionSet(
    questionSetId: number
  ) {
    window.location.href =
      `/pdf/questions?setId=${encodeURIComponent(
        questionSetId
      )}`;
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

        {/* ==================== 頂部登入狀態 ==================== */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">

          <button
            type="button"
            onClick={() => {
              window.location.href = "/";
            }}
            className="
              rounded-lg
              border
              border-gray-300
              bg-white
              px-4
              py-2
              font-semibold
              text-gray-700
              hover:bg-gray-50
            "
          >
            ← 回首頁
          </button>

          {sessionLoading ? (
            <div className="rounded-xl bg-white px-5 py-3 shadow-sm">
              <span className="text-sm text-gray-500">
                正在確認登入狀態...
              </span>
            </div>
          ) : isLoggedIn ? (
            <div className="flex flex-wrap items-center gap-3">

              <div className="rounded-xl border border-gray-200 bg-white px-5 py-3 shadow-sm">
                <div className="font-bold text-gray-900">
                  {session.user.name ||
                    session.user.email}
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold text-green-600">
                    已登入
                  </span>

                  {subscriptionLoading ? (
                    <span className="rounded-full bg-gray-100 px-3 py-1 text-gray-500">
                      會員資料讀取中
                    </span>
                  ) : isPro ? (
                    <span className="rounded-full bg-yellow-100 px-3 py-1 font-bold text-yellow-700">
                      PRO 會員
                    </span>
                  ) : (
                    <span className="rounded-full bg-gray-100 px-3 py-1 font-semibold text-gray-600">
                      免費會員
                    </span>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={handleLogout}
                className="
                  rounded-lg
                  border
                  border-red-200
                  bg-white
                  px-4
                  py-2
                  font-semibold
                  text-red-600
                  hover:bg-red-50
                "
              >
                登出
              </button>

            </div>
          ) : (
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  window.location.href =
                    "/login";
                }}
                className="
                  rounded-lg
                  bg-blue-600
                  px-4
                  py-2
                  font-semibold
                  text-white
                  hover:bg-blue-700
                "
              >
                登入
              </button>

              <button
                type="button"
                onClick={() => {
                  window.location.href =
                    "/register";
                }}
                className="
                  rounded-lg
                  bg-green-600
                  px-4
                  py-2
                  font-semibold
                  text-white
                  hover:bg-green-700
                "
              >
                註冊
              </button>
            </div>
          )}
        </div>

        <h1 className="text-4xl font-bold text-blue-900">
          PDF 題庫
        </h1>

        <p className="mt-3 text-gray-600">
          上傳你的考試 PDF，自動辨識選擇題並建立私人題庫。
        </p>

        {/* ==================== 已匯入題庫 ==================== */}
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
              disabled={
                loadingQuestionSets
              }
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
          ) : questionSets.length ===
            0 ? (
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

                        {questionSet.filename && (
                          <p className="mt-1 text-sm text-gray-500">
                            {
                              questionSet.filename
                            }
                          </p>
                        )}

                        <div className="mt-3 flex flex-wrap gap-2 text-sm">
                          <span className="rounded-full bg-blue-100 px-3 py-1 font-semibold text-blue-700">
                            {
                              questionSet.total_questions
                            }{" "}
                            題
                          </span>

                          {questionSet.exam_subject && (
                            <span className="rounded-full bg-orange-100 px-3 py-1 font-semibold text-orange-700">
                              {
                                questionSet.exam_subject
                              }
                            </span>
                          )}

                          {questionSet.exam_year && (
                            <span className="rounded-full bg-yellow-100 px-3 py-1 font-semibold text-yellow-700">
                              {
                                questionSet.exam_year
                              }{" "}
                              年
                            </span>
                          )}

                          <span className="rounded-full bg-purple-100 px-3 py-1 font-semibold text-purple-700">
                            私人題庫
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

        {/* ==================== 匯入模式 ==================== */}
        <div className="mt-8 rounded-2xl bg-white p-3 shadow">
          <div className="grid gap-3 md:grid-cols-2">
            <button
              type="button"
              onClick={() => {
                setImportMode("pdf");
                setManualMessage("");
              }}
              className={`rounded-xl px-5 py-4 text-lg font-bold transition ${
                importMode === "pdf"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              PDF 自動匯入
            </button>

            <button
              type="button"
              onClick={() => {
                setImportMode("manual");
                setMessage("");
              }}
              className={`rounded-xl px-5 py-4 text-lg font-bold transition ${
                importMode === "manual"
                  ? "bg-green-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              手動建立題目
            </button>
          </div>
        </div>

        {/* ==================== PDF ==================== */}
        {importMode === "pdf" && (
          <div className="mt-8 rounded-2xl bg-white p-8 shadow">
            <h2 className="text-2xl font-bold text-gray-900">
              PDF 自動匯入
            </h2>

            <p className="mt-2 text-sm text-gray-500">
              上傳含有選擇題文字的 PDF，系統會自動辨識題目與選項。最大 20 MB。
            </p>

            {!sessionLoading &&
              !isLoggedIn && (
                <div className="mt-5 rounded-xl border border-blue-200 bg-blue-50 p-5">
                  <p className="font-bold text-blue-900">
                    請先登入
                  </p>

                  <p className="mt-2 text-sm text-blue-800">
                    登入後才能建立私人題庫。
                  </p>

                  <button
                    type="button"
                    onClick={() => {
                      window.location.href =
                        "/login";
                    }}
                    className="
                      mt-4
                      rounded-lg
                      bg-blue-600
                      px-5
                      py-2.5
                      font-bold
                      text-white
                      hover:bg-blue-700
                    "
                  >
                    前往登入
                  </button>
                </div>
              )}

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

            <div className="mt-6 rounded-xl border-2 border-purple-500 bg-purple-50 p-5">
              <div className="text-lg font-bold text-purple-900">
                私人題庫
              </div>

              <p className="mt-2 text-sm text-purple-800">
                這份 PDF 只會建立你的私人題庫，不會直接公開給其他使用者。
              </p>
            </div>

            <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-5">
              <h3 className="text-lg font-bold text-gray-900">
                國考科目
              </h3>

              <p className="mt-1 text-sm text-gray-600">
                如果這份 PDF 是國考相關資料，可以選擇對應科目。
              </p>

              <div className="mt-4">
                <select
                  value={examSubject}
                  onChange={(event) =>
                    setExamSubject(
                      event.target.value
                    )
                  }
                  className="
                    w-full
                    rounded-lg
                    border
                    border-gray-300
                    bg-white
                    px-4
                    py-3
                    text-gray-900
                  "
                >
                  <option value="">
                    不指定國考科目
                  </option>

                  {EXAM_SUBJECTS.map(
                    (subject) => (
                      <option
                        key={subject}
                        value={subject}
                      >
                        {subject}
                      </option>
                    )
                  )}
                </select>
              </div>
            </div>

            {examSubject && (
              <div className="mt-4 rounded-xl border border-orange-200 bg-orange-50 p-5">
                <h3 className="text-lg font-bold text-orange-900">
                  國考年份
                </h3>

                <p className="mt-1 text-sm text-orange-800">
                  如果是特定年度國考題，可以指定年份。
                </p>

                <select
                  value={examYear}
                  onChange={(event) =>
                    setExamYear(
                      event.target.value
                        ? Number(
                            event.target.value
                          )
                        : ""
                    )
                  }
                  className="
                    mt-4
                    w-full
                    rounded-lg
                    border
                    border-gray-300
                    bg-white
                    px-4
                    py-3
                    text-gray-900
                  "
                >
                  <option value="">
                    不指定年份
                  </option>

                  {EXAM_YEARS.map(
                    (year) => (
                      <option
                        key={year}
                        value={year}
                      >
                        {year} 年
                      </option>
                    )
                  )}
                </select>
              </div>
            )}

            <p className="mt-4 text-sm text-gray-500">
              公開國考題庫目前由管理員統一管理，一般使用者無法直接上傳公開題目。
            </p>

            <button
              type="button"
              onClick={handleUpload}
              disabled={
                loading ||
                sessionLoading ||
                !isLoggedIn
              }
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
              <div className="mt-5 rounded-lg bg-gray-100 p-4 font-semibold text-gray-800">
                {message}
              </div>
            )}

            {upgradeRequired && (
              <div className="mt-4 rounded-xl border border-yellow-200 bg-yellow-50 p-5">
                <p className="font-bold text-yellow-900">
                  PDF 匯入功能需要 PRO 會員
                </p>

                <p className="mt-2 text-sm text-yellow-800">
                  升級 PRO 後即可使用 PDF 自動辨識與題庫匯入功能。
                </p>

                <button
                  type="button"
                  className="
                    mt-4
                    rounded-lg
                    bg-yellow-600
                    px-5
                    py-2.5
                    font-bold
                    text-white
                    hover:bg-yellow-700
                  "
                  onClick={() => {
                    window.location.href =
                      "/";
                  }}
                >
                  查看 PRO 方案
                </button>
              </div>
            )}
          </div>
        )}

        {/* ==================== 手動 ==================== */}
        {importMode === "manual" && (
          <div className="mt-8 rounded-2xl bg-white p-8 shadow">
            <h2 className="text-2xl font-bold text-gray-900">
              手動建立題目
            </h2>

            <p className="mt-2 text-sm text-gray-500">
              PDF 格式無法辨識時，可以直接手動輸入題目。建立後只會保存到你的私人題庫。
            </p>

            <div className="mt-6">
              <label className="block text-sm font-semibold text-gray-700">
                題庫名稱
              </label>

              <input
                type="text"
                value={manualSetName}
                onChange={(event) =>
                  setManualSetName(
                    event.target.value
                  )
                }
                placeholder="例如：我的內科整理"
                className="
                  mt-2
                  w-full
                  rounded-lg
                  border
                  border-gray-300
                  px-4
                  py-3
                  text-gray-900
                  outline-none
                  focus:border-blue-500
                  focus:ring-2
                  focus:ring-blue-100
                "
              />
            </div>

            <div className="mt-6 rounded-xl border-2 border-purple-500 bg-purple-50 p-5">
              <div className="text-lg font-bold text-purple-900">
                私人題庫
              </div>

              <p className="mt-2 text-sm text-purple-800">
                手動建立的題目只會保存給自己使用。
              </p>
            </div>

            <div className="mt-6">
              <label className="block text-sm font-semibold text-gray-700">
                國考科目
              </label>

              <select
                value={examSubject}
                onChange={(event) =>
                  setExamSubject(
                    event.target.value
                  )
                }
                className="
                  mt-2
                  w-full
                  rounded-lg
                  border
                  border-gray-300
                  bg-white
                  px-4
                  py-3
                  text-gray-900
                "
              >
                <option value="">
                  不指定國考科目
                </option>

                {EXAM_SUBJECTS.map(
                  (subject) => (
                    <option
                      key={subject}
                      value={subject}
                    >
                      {subject}
                    </option>
                  )
                )}
              </select>
            </div>

            {examSubject && (
              <div className="mt-4">
                <label className="block text-sm font-semibold text-gray-700">
                  國考年份
                </label>

                <select
                  value={examYear}
                  onChange={(event) =>
                    setExamYear(
                      event.target.value
                        ? Number(
                            event.target.value
                          )
                        : ""
                    )
                  }
                  className="
                    mt-2
                    w-full
                    rounded-lg
                    border
                    border-gray-300
                    bg-white
                    px-4
                    py-3
                    text-gray-900
                  "
                >
                  <option value="">
                    不指定年份
                  </option>

                  {EXAM_YEARS.map(
                    (year) => (
                      <option
                        key={year}
                        value={year}
                      >
                        {year} 年
                      </option>
                    )
                  )}
                </select>
              </div>
            )}

            <div className="mt-8 space-y-6">
              {manualQuestions.map(
                (
                  question,
                  questionIndex
                ) => (
                  <div
                    key={questionIndex}
                    className="
                      rounded-2xl
                      border
                      border-gray-200
                      bg-gray-50
                      p-6
                    "
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="text-xl font-bold text-gray-900">
                        第{" "}
                        {questionIndex + 1}{" "}
                        題
                      </h3>

                      {manualQuestions.length >
                        1 && (
                        <button
                          type="button"
                          onClick={() =>
                            removeManualQuestion(
                              questionIndex
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
                      )}
                    </div>

                    <textarea
                      value={
                        question.question
                      }
                      onChange={(event) =>
                        updateManualQuestion(
                          questionIndex,
                          event.target.value
                        )
                      }
                      rows={4}
                      placeholder="輸入題目內容..."
                      className="
                        mt-4
                        w-full
                        rounded-lg
                        border
                        border-gray-300
                        bg-white
                        p-4
                        text-gray-900
                        outline-none
                        focus:border-blue-500
                        focus:ring-2
                        focus:ring-blue-100
                      "
                    />

                    <div className="mt-5 grid gap-3">
                      {question.options.map(
                        (
                          option,
                          optionIndex
                        ) => (
                          <div
                            key={optionIndex}
                            className="flex items-center gap-3"
                          >
                            <div
                              className="
                                flex
                                h-9
                                w-9
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

                            <input
                              type="text"
                              value={option}
                              onChange={(
                                event
                              ) =>
                                updateManualOption(
                                  questionIndex,
                                  optionIndex,
                                  event.target
                                    .value
                                )
                              }
                              placeholder={`選項 ${String.fromCharCode(
                                65 +
                                  optionIndex
                              )}`}
                              className="
                                w-full
                                rounded-lg
                                border
                                border-gray-300
                                bg-white
                                px-4
                                py-3
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

                    <div className="mt-5 grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="block text-sm font-semibold text-gray-700">
                          正確答案
                        </label>

                        <select
                          value={
                            question.answer
                          }
                          onChange={(event) =>
                            updateManualAnswer(
                              questionIndex,
                              event.target.value
                            )
                          }
                          className="
                            mt-2
                            w-full
                            rounded-lg
                            border
                            border-gray-300
                            bg-white
                            px-4
                            py-3
                            text-gray-900
                          "
                        >
                          <option value="">
                            尚未設定
                          </option>

                          <option value="A">
                            A
                          </option>

                          <option value="B">
                            B
                          </option>

                          <option value="C">
                            C
                          </option>

                          <option value="D">
                            D
                          </option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-semibold text-gray-700">
                          解析
                        </label>

                        <textarea
                          value={
                            question.explanation
                          }
                          onChange={(event) =>
                            updateManualExplanation(
                              questionIndex,
                              event.target.value
                            )
                          }
                          rows={3}
                          placeholder="輸入題目解析..."
                          className="
                            mt-2
                            w-full
                            rounded-lg
                            border
                            border-gray-300
                            bg-white
                            p-3
                            text-gray-900
                          "
                        />
                      </div>
                    </div>
                  </div>
                )
              )}
            </div>

            <button
              type="button"
              onClick={addManualQuestion}
              className="
                mt-6
                rounded-lg
                border
                border-blue-300
                bg-blue-50
                px-5
                py-3
                font-bold
                text-blue-700
                hover:bg-blue-100
              "
            >
              + 新增一題
            </button>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={handleManualImport}
                disabled={
                  manualLoading ||
                  sessionLoading ||
                  !isLoggedIn
                }
                className="
                  rounded-lg
                  bg-green-600
                  px-6
                  py-3
                  font-bold
                  text-white
                  hover:bg-green-700
                  disabled:cursor-not-allowed
                  disabled:bg-gray-400
                "
              >
                {manualLoading
                  ? "正在匯入..."
                  : `建立私人題庫（${manualQuestions.length} 題）`}
              </button>

              {manualMessage && (
                <div className="rounded-lg bg-gray-100 px-4 py-3 font-semibold text-gray-800">
                  {manualMessage}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ==================== PDF 辨識結果 ==================== */}
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
                    className="rounded-2xl bg-white p-6 shadow"
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
                        value={
                          question.question
                        }
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
                              key={
                                optionIndex
                              }
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
                                value={
                                  option
                                }
                                onChange={(
                                  event
                                ) =>
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