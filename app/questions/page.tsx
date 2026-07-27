"use client";

import { useState } from "react";
import { questions } from "@/data/questions";

export default function QuestionsPage() {
    const currentQuestion = questions[0];

  const answer = currentQuestion.answer;


  const [selected, setSelected] = useState("");
  const [showResult, setShowResult] = useState(false);


  function checkAnswer() {
    setShowResult(true);
  }


  return (
    <main className="min-h-screen bg-gray-100 p-10">

      <div className="mx-auto max-w-3xl rounded-xl bg-white p-8 shadow">

        <p className="font-bold text-blue-600">
          犬內科 第 1 / 100 題
        </p>


        <h1 className="mt-4 text-3xl font-bold">
          {currentQuestion.question}
        </h1>


        <div className="mt-8 space-y-4">

        {currentQuestion.options.map((option, index)=>(
  <button
    key={option}
    onClick={()=>setSelected(String.fromCharCode(65 + index))}
    className={`w-full rounded-lg border p-4 text-left
    ${
      selected === String.fromCharCode(65 + index)
      ? "bg-blue-100 border-blue-500"
      : ""
    }`}
  >
    {String.fromCharCode(65 + index)}. {option}
  </button>
))}

        </div>


        <button
          onClick={checkAnswer}
          className="mt-8 rounded-lg bg-blue-600 px-6 py-3 text-white"
        >
          確認答案
        </button>


        {
          showResult && (
            <div className="mt-8 rounded-lg bg-gray-100 p-5">

              {
                selected === answer
                ?
                <p className="text-green-600 font-bold">
                  ✓ 答對了
                </p>
                :
                <p className="text-red-600 font-bold">
                  ✗ 答錯了，答案是 B
                </p>
              }


              <p className="mt-3">
                解析：
               {currentQuestion.explanation}
              </p>

            </div>
          )
        }


      </div>

    </main>
  );
}