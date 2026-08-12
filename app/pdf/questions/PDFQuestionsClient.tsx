"use client";

import { useEffect, useState } from "react";

type Question = {
  id: number;
  questionNumber: number;
  subject: string;
  question: string;
  options: string[];
  answer: string;
  explanation: string;
};

type QuestionSet = {
  id: number;
  name: string;
  filename: string;
  totalQuestions: number;
  visibility: "public" | "private";
  ownerId: string | null;
};

type Props = {
  questionSetId: string;
};

type ErrorResponse = {
  error?: string;
  code?: string;
};

export default function PDFQuestionsClient({
  questionSetId,
}: Props) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [questionSet, setQuestionSet] = useState<QuestionSet | null>(null);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showLoginModal, setShowLoginModal] = useState(false);

  useEffect(() => {
    if (!questionSetId) {
      setError("找不到題庫 ID。");
      setLoading(false);
      return;
    }

    loadQuestions();
  }, [questionSetId]);

  async function loadQuestions() {
    try {
      setLoading(true);
      setError("");

      const response = await fetch(
        `/api/question-sets/${encodeURIComponent(
          questionSetId
        )}/questions`,
        {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        }
      );

      const data = await response.json();

      if (!response.ok) {
        const errorData = data as ErrorResponse;

        if (
          response.status === 401 &&
          errorData.code === "LOGIN_REQUIRED"
        ) {
          setShowLoginModal(true);
          setLoading(false);
          return;
        }

        if (response.status === 403) {
          setError(
            errorData.error ||
              "你沒有權限使用這個私人題庫。"
          );
          setLoading(false);
          return;
        }

        throw new Error(
          errorData.error || "無法載入題庫。"
        );
      }

      setQuestions(data.questions || []);
      setQuestionSet(data.questionSet || null);
    } catch (err) {
      console.error(err);

      setError(
        err instanceof Error
          ? err.message
          : "無法載入題庫。"
      );
    } finally {
      setLoading(false);
    }
  }

  function goToLogin() {
    const callbackURL = `/pdf/questions?setId=${encodeURIComponent(
      questionSetId
    )}`;

    window.location.href = `/login?callbackURL=${encodeURIComponent(
      callbackURL
    )}`;
  }

  function goToRegister() {
    const callbackURL = `/pdf/questions?setId=${encodeURIComponent(
      questionSetId
    )}`;

    window.location.href = `/register?callbackURL=${encodeURIComponent(
      callbackURL
    )}`;
  }

  function selectAnswer(option: string) {
    if (showResult) {
      return;
    }

    setSelected(option);
    setShowResult(true);
  }

  function nextQuestion() {
    if (currentIndex >= questions.length - 1) {
      return;
    }

    setCurrentIndex((prev) => prev + 1);
    setSelected(null);
    setShowResult(false);
  }

  function exitQuestions() {
    window.location.href = "/pdf";
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 px-4 py-10">
        <div className="mx-auto max-w-3xl rounded-2xl bg-white p-8 shadow">
          <p className="text-center text-gray-600">
            正在載入題庫...
          </p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-gray-50 px-4 py-10">
        <div className="mx-auto max-w-3xl rounded-2xl bg-white p-8 shadow">
          <h1 className="mb-4 text-xl font-bold text-gray-900">
            無法載入題庫
          </h1>

          <p className="mb-6 text-gray-600">
            {error}
          </p>

          <button
            type="button"
            onClick={exitQuestions}
            className="rounded-lg bg-gray-800 px-5 py-2.5 text-white hover:bg-gray-700"
          >
            返回題庫
          </button>
        </div>
      </main>
    );
  }

  if (questions.length === 0) {
    return (
      <>
        <main className="min-h-screen bg-gray-50 px-4 py-10">
          <div className="mx-auto max-w-3xl rounded-2xl bg-white p-8 shadow">
            <h1 className="mb-4 text-xl font-bold text-gray-900">
              題庫目前沒有題目
            </h1>

            <button
              type="button"
              onClick={exitQuestions}
              className="rounded-lg bg-gray-800 px-5 py-2.5 text-white hover:bg-gray-700"
            >
              返回題庫
            </button>
          </div>
        </main>

        {showLoginModal && (
          <LoginRequiredModal
            onLogin={goToLogin}
            onRegister={goToRegister}
            onCancel={exitQuestions}
          />
        )}
      </>
    );
  }

  const currentQuestion = questions[currentIndex];

  const isCorrect =
    selected !== null &&
    selected === currentQuestion.answer;

  return (
    <>
      <main className="min-h-screen bg-gray-50 px-4 py-8">
        <div className="mx-auto max-w-4xl">
          <div className="mb-6 rounded-2xl bg-white p-6 shadow">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  {questionSet?.name || "題庫"}
                </h1>

                {questionSet?.filename && (
                  <p className="mt-1 text-sm text-gray-500">
                    {questionSet.filename}
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={exitQuestions}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                退出刷題
              </button>
            </div>

            <div className="mt-5 flex items-center justify-between text-sm text-gray-500">
              <span>
                第 {currentIndex + 1} / {questions.length} 題
              </span>

              <span>
                {currentQuestion.subject || "未分類"}
              </span>
            </div>

            <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-200">
              <div
                className="h-full rounded-full bg-blue-600 transition-all"
                style={{
                  width: `${
                    ((currentIndex + 1) /
                      questions.length) *
                    100
                  }%`,
                }}
              />
            </div>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow">
            <div className="mb-8">
              <h2 className="whitespace-pre-wrap text-lg font-semibold leading-8 text-gray-900">
                {currentQuestion.question}
              </h2>
            </div>

            <div className="space-y-3">
              {currentQuestion.options.map(
                (option, index) => {
                  const letter = String.fromCharCode(
                    65 + index
                  );

                  const isSelected =
                    selected === option;

                  const isAnswer =
                    currentQuestion.answer === option ||
                    currentQuestion.answer === letter;

                  let className =
                    "w-full rounded-xl border p-4 text-left transition";

                  if (!showResult) {
                    className +=
                      " border-gray-300 hover:border-blue-500 hover:bg-blue-50";
                  } else if (isAnswer) {
                    className +=
                      " border-green-500 bg-green-50";
                  } else if (isSelected) {
                    className +=
                      " border-red-500 bg-red-50";
                  } else {
                    className +=
                      " border-gray-200 bg-gray-50";
                  }

                  return (
                    <button
                      key={`${currentQuestion.id}-${index}`}
                      type="button"
                      onClick={() =>
                        selectAnswer(option)
                      }
                      disabled={showResult}
                      className={className}
                    >
                      <div className="flex gap-3">
                        <span className="font-bold">
                          {letter}.
                        </span>

                        <span className="whitespace-pre-wrap">
                          {option}
                        </span>
                      </div>
                    </button>
                  );
                }
              )}
            </div>

            {showResult && (
              <div
                className={`mt-6 rounded-xl border p-5 ${
                  isCorrect
                    ? "border-green-300 bg-green-50"
                    : "border-red-300 bg-red-50"
                }`}
              >
                <p
                  className={`font-bold ${
                    isCorrect
                      ? "text-green-700"
                      : "text-red-700"
                  }`}
                >
                  {isCorrect ? "答對了！" : "答錯了！"}
                </p>

                <p className="mt-2 text-gray-700">
                  正確答案：
                  <strong>
                    {currentQuestion.answer}
                  </strong>
                </p>

                {currentQuestion.explanation && (
                  <div className="mt-4">
                    <p className="font-semibold text-gray-900">
                      解析
                    </p>

                    <p className="mt-1 whitespace-pre-wrap leading-7 text-gray-700">
                      {currentQuestion.explanation}
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="mt-8 flex justify-end">
              {showResult &&
                currentIndex < questions.length - 1 && (
                  <button
                    type="button"
                    onClick={nextQuestion}
                    className="rounded-lg bg-blue-600 px-6 py-3 font-medium text-white hover:bg-blue-700"
                  >
                    下一題
                  </button>
                )}

              {showResult &&
                currentIndex === questions.length - 1 && (
                  <button
                    type="button"
                    onClick={exitQuestions}
                    className="rounded-lg bg-blue-600 px-6 py-3 font-medium text-white hover:bg-blue-700"
                  >
                    完成
                  </button>
                )}
            </div>
          </div>
        </div>
      </main>

      {showLoginModal && (
        <LoginRequiredModal
          onLogin={goToLogin}
          onRegister={goToRegister}
          onCancel={exitQuestions}
        />
      )}
    </>
  );
}

type LoginRequiredModalProps = {
  onLogin: () => void;
  onRegister: () => void;
  onCancel: () => void;
};

function LoginRequiredModal({
  onLogin,
  onRegister,
  onCancel,
}: LoginRequiredModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="login-required-title"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-7 shadow-2xl">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-100">
            <span className="text-2xl">🔐</span>
          </div>

          <h2
            id="login-required-title"
            className="text-xl font-bold text-gray-900"
          >
            尚未登入
          </h2>

          <p className="mt-3 leading-7 text-gray-600">
            使用私人題庫需要登入帳號。
            <br />
            請登入或註冊後繼續刷題。
          </p>
        </div>

        <div className="mt-7 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onLogin}
            className="rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700"
          >
            登入
          </button>

          <button
            type="button"
            onClick={onRegister}
            className="rounded-xl border border-blue-600 px-4 py-3 font-semibold text-blue-600 hover:bg-blue-50"
          >
            註冊
          </button>
        </div>

        <button
          type="button"
          onClick={onCancel}
          className="mt-3 w-full rounded-xl px-4 py-3 text-gray-500 hover:bg-gray-100"
        >
          取消
        </button>
      </div>
    </div>
  );
}