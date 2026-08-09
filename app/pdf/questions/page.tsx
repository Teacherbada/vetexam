"use client";

import { useEffect, useState } from "react";
import HomeButton from "@/components/HomeButton";

type Question = {
  id: number;
  subject: string;
  question: string;
  options: string[];
  answer: string;
  explanation: string;
};

export default function PDFQuestionsPage() {

  const [questions, setQuestions] =
    useState<Question[]>([]);

  const [currentIndex, setCurrentIndex] =
    useState(0);

  const [selected, setSelected] =
    useState("");

  const [finished, setFinished] =
    useState(false);

  useEffect(() => {

    const data =
      JSON.parse(
        localStorage.getItem(
          "pdfQuestions"
        ) || "[]"
      );

    setQuestions(data);

  }, []);

  if (questions.length === 0) {
    return (
      <main className="min-h-screen bg-gray-100 p-10">
        <div className="mx-auto max-w-3xl rounded-xl bg-white p-8 text-center shadow">

          <h1 className="text-2xl font-bold">
            目前沒有 PDF 題目
          </h1>

          <div className="mt-6">
            <HomeButton />
          </div>

        </div>
      </main>
    );
  }

  if (finished) {
    return (
      <main className="min-h-screen bg-gray-100 p-10">
        <div className="mx-auto max-w-3xl rounded-xl bg-white p-8 text-center shadow">

          <h1 className="text-4xl font-bold">
            🎉 題目完成
          </h1>

          <p className="mt-4 text-gray-600">
            已完成這份 PDF 題庫。
          </p>

          <div className="mt-6">
            <HomeButton />
          </div>

        </div>
      </main>
    );
  }

  const question =
    questions[currentIndex];

  function nextQuestion() {

    if (
      currentIndex <
      questions.length - 1
    ) {

      setCurrentIndex(
        currentIndex + 1
      );

      setSelected("");

    } else {

      setFinished(true);

    }
  }

  return (
    <main className="min-h-screen bg-gray-100 p-10">

      <div className="mx-auto max-w-3xl">

        <button
          onClick={() => {
            const ok =
              window.confirm(
                "確定要退出這份 PDF 題庫嗎？"
              );

            if (ok) {
              window.location.href =
                "/pdf";
            }
          }}
          className="
            mb-6
            rounded-lg
            bg-red-500
            px-5
            py-2
            text-white
            hover:bg-red-600
          "
        >
          🚪 退出測驗
        </button>

        <div className="rounded-xl bg-white p-8 shadow">

          <p className="font-bold text-blue-600">
            PDF 題庫
            {" · "}
            第 {currentIndex + 1}
            {" / "}
            {questions.length}
            {" 題"}
          </p>

          <h1 className="mt-6 text-2xl font-bold">
            {question.question}
          </h1>

          <div className="mt-8 space-y-4">

            {question.options.map(
              (option, index) => {

                const letter =
                  String.fromCharCode(
                    65 + index
                  );

                return (
                  <button
                    key={index}
                    onClick={() =>
                      setSelected(letter)
                    }
                    className={`
                      w-full
                      rounded-lg
                      border
                      p-4
                      text-left
                      ${
                        selected === letter
                          ? "border-blue-500 bg-blue-100"
                          : "hover:bg-gray-50"
                      }
                    `}
                  >
                    {letter}. {option}
                  </button>
                );
              }
            )}

          </div>

          <button
            onClick={nextQuestion}
            disabled={!selected}
            className="
              mt-8
              rounded-lg
              bg-blue-600
              px-6
              py-3
              text-white
              hover:bg-blue-700
              disabled:bg-gray-400
            "
          >
            {currentIndex <
            questions.length - 1
              ? "下一題 →"
              : "完成"}
          </button>

        </div>

      </div>

    </main>
  );
}