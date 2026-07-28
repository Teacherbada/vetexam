"use client";

import { useEffect, useState } from "react";


export default function WrongTestPage(){


  const [questions,setQuestions] = useState<any[]>([]);

  const [currentIndex,setCurrentIndex] = useState(0);

  const [selected,setSelected] = useState("");

  const [showResult,setShowResult] = useState(false);

  const [score,setScore] = useState(0);

  const [finished,setFinished] = useState(false);



  useEffect(()=>{


    const data =
      JSON.parse(
        localStorage.getItem("wrongQuestions") || "[]"
      );


    setQuestions(data);


  },[]);




  if(questions.length === 0){


    return (

      <main className="min-h-screen bg-gray-100 p-10">

        <div className="mx-auto max-w-3xl rounded-xl bg-white p-8 shadow">

          目前沒有錯題可以練習 🎉

        </div>

      </main>

    );

  }



  const currentQuestion =
    questions[currentIndex];



  const answer =
    currentQuestion.answer;





  function checkAnswer(){


    setShowResult(true);


    if(selected === answer){

      setScore(score + 1);

    }


  }





  function nextQuestion(){


    if(currentIndex < questions.length - 1){


      setCurrentIndex(currentIndex + 1);

      setSelected("");

      setShowResult(false);


    }else{


      setFinished(true);


    }


  }







  if(finished){


    return (

      <main className="min-h-screen bg-gray-100 p-10">


        <div className="mx-auto max-w-3xl rounded-xl bg-white p-8 text-center shadow">


          <h1 className="text-4xl font-bold">

            🎯 錯題複習完成

          </h1>



          <p className="mt-6 text-2xl">

            得分：

            {score}

            /

            {questions.length}

          </p>



          <p className="mt-4 text-xl">

            正確率：

            {

              Math.round(

                score /

                questions.length *

                100

              )

            }%

          </p>



        </div>


      </main>

    );


  }







  return(


    <main className="min-h-screen bg-gray-100 p-10">


      <div className="mx-auto max-w-3xl rounded-xl bg-white p-8 shadow">


        <p className="font-bold text-blue-600">

          錯題複習

          第 {currentIndex + 1}

          /

          {questions.length}

          題

        </p>




        <h1 className="mt-5 text-3xl font-bold">

          {currentQuestion.question}

        </h1>





        <div className="mt-8 space-y-4">


        {

          currentQuestion.options.map(
            (option:string,index:number)=>(


            <button

              key={option}

              onClick={()=>{

                setSelected(
                  String.fromCharCode(65+index)
                )

              }}


              className={`
              
              w-full rounded-lg border p-4 text-left

              ${
                selected === String.fromCharCode(65+index)

                ?

                "bg-blue-100 border-blue-500"

                :

                ""

              }

              `}

            >

              {String.fromCharCode(65+index)}.

              {option}


            </button>


            )

          )

        }


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

                <p className="font-bold text-green-600">

                  ✓ 答對了

                </p>


                :

                <p className="font-bold text-red-600">

                  ✗ 答錯了

                  正確答案：

                  {answer}

                </p>

              }




              <p className="mt-3">

                解析：

                {currentQuestion.explanation}

              </p>





              <button

                onClick={nextQuestion}

                className="mt-5 rounded-lg bg-green-600 px-6 py-3 text-white"

              >

                下一題 →

              </button>



            </div>

          )

        }




      </div>


    </main>


  );


}