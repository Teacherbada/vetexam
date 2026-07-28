"use client";

import { saveProgress } from "@/data/progress";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { questions } from "@/data/questions";
import { saveWrongQuestion } from "@/data/wrongAnswers";
import { addDailyProgress } from "@/data/tasksProgress";
import { getFavorites, toggleFavorite } from "@/data/favorites";


export default function QuestionsPage() {


  const searchParams = useSearchParams();

  const subject = searchParams.get("subject");



  const filteredQuestions = subject
    ? questions.filter(
        (q) => q.subject === subject
      )
    : questions;



  const [currentIndex, setCurrentIndex] = useState(0);

  const [selected, setSelected] = useState("");

  const [showResult, setShowResult] = useState(false);

  const [score, setScore] = useState(0);

  const [favorites, setFavorites] = useState<any[]>([]);

  const [answered, setAnswered] = useState(false);

  const [finished, setFinished] = useState(false);



  const currentQuestion =
    filteredQuestions[currentIndex];



  useEffect(()=>{

    setFavorites(
      getFavorites()
    );

  },[]);



  if (!currentQuestion) {

    return null;

  }



  const answer = currentQuestion.answer;



  function checkAnswer() {


    if (answered) return;


    addDailyProgress();


    setShowResult(true);

    setAnswered(true);



    const correct =
      selected === answer;



    saveProgress(
      currentQuestion.id,
      correct,
      currentQuestion.subject
    );



    if(correct){

      setScore(score + 1);

    }

    else {

  saveWrongQuestion(
    currentQuestion,
    selected
  );
}
}




  function nextQuestion(){


    if(
      currentIndex < filteredQuestions.length - 1
    ){


      setCurrentIndex(currentIndex + 1);

      setSelected("");

      setShowResult(false);

      setAnswered(false);


    }

    else{


      setFinished(true);


    }


  }





  function favoriteQuestion(){


    const updated =
      toggleFavorite(currentQuestion);


    setFavorites(updated);


  }





  if(finished){


    return (

      <main className="min-h-screen bg-gray-100 p-10">


        <div className="mx-auto max-w-3xl rounded-xl bg-white p-8 shadow text-center">


          <h1 className="text-4xl font-bold">

            🎉 測驗完成

          </h1>



          <p className="mt-6 text-2xl">

            得分：

            {score}

            /

            {filteredQuestions.length}

          </p>




          <p className="mt-4 text-xl">

            正確率：

            {Math.round(
              (score / filteredQuestions.length) * 100
            )}

            %

          </p>



        </div>


      </main>

    );


  }





  const isFavorite =
    favorites.some(
      (item)=>item.id === currentQuestion.id
    );





  return (


    <main className="min-h-screen bg-gray-100 p-10">


      <div className="mx-auto max-w-3xl rounded-xl bg-white p-8 shadow">



        <p className="font-bold text-blue-600">

          {currentQuestion.subject}

          {" 第 "}

          {currentIndex + 1}

          {" / "}

          {filteredQuestions.length}

          {" 題"}

        </p>




        <p className="mt-2 text-gray-600">

          目前得分：

          {score}

        </p>





        <h1 className="mt-4 text-3xl font-bold">

          {currentQuestion.question}

        </h1>




        <button

          onClick={favoriteQuestion}

          className="mt-4 rounded-lg border px-4 py-2"

        >

          {
            isFavorite
            ? "★ 已收藏"
            : "☆ 收藏題目"
          }

        </button>






        <div className="mt-8 space-y-4">


          {
            currentQuestion.options.map(
              (option,index)=>(


              <button

                key={option}

                disabled={answered}

                onClick={()=>{

                  setSelected(
                    String.fromCharCode(65 + index)
                  );

                }}


                className={`
                w-full rounded-lg border p-4 text-left

                ${
                  selected ===
                  String.fromCharCode(65 + index)

                  ?

                  "bg-blue-100 border-blue-500"

                  :

                  ""

                }

                `}

              >

                {String.fromCharCode(65 + index)}.
                {option}


              </button>


              )
            )

          }


        </div>





        {
          !showResult && (

          <button

            onClick={checkAnswer}

            className="mt-8 rounded-lg bg-blue-600 px-6 py-3 text-white"

          >

            確認答案

          </button>

          )

        }







        {

          showResult && (


            <div className="mt-8 rounded-lg bg-gray-100 p-5">


              {

                selected === answer


                ?

                <p className="font-bold text-green-600">

                  ✓ 答對了

                </p>


                :


                <p className="font-bold text-red-600">

                  ✗ 答錯了，答案是 {answer}

                </p>


              }





              <p className="mt-3">

                解析：

                {currentQuestion.explanation}

              </p>





              <button


                onClick={nextQuestion}


                className="mt-6 rounded-lg bg-green-600 px-6 py-3 text-white"


              >

                {
                  currentIndex <
                  filteredQuestions.length - 1

                  ?

                  "下一題 →"

                  :

                  "完成測驗"

                }


              </button>



            </div>


          )

        }




      </div>


    </main>


  );


}