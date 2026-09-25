"use client";
import foundation from "@/components/ui/foundation.module.css";
import styles from "@/app/questions/focus.module.css";
import { EmptyState } from "@/components/ui/ContentState";
import { StudyIcon } from "@/components/dashboard/StudyUI";
import { reviewItems, subscribeLearning } from "@/lib/learning-client";

import { useEffect, useState } from "react";


import { sendStatistics } from '@/lib/answer-statistics-client';

export default function WrongTestPage(){


  const [questions,setQuestions] = useState<any[]>([]);

  const [currentIndex,setCurrentIndex] = useState(0);

  const [selected,setSelected] = useState("");

  const [showResult,setShowResult] = useState(false);

  const [score,setScore] = useState(0);

  const [finished,setFinished] = useState(false);



  useEffect(()=>{


    const data =
      reviewItems('wrongQuestions');


    setQuestions(data);


    return subscribeLearning(() => setQuestions(reviewItems('wrongQuestions')));
  },[]);




  if(questions.length === 0){


    return (

      <main className={`${foundation.foundation} ${styles.page}`}>

        <div className={`${styles.container} ${styles.card}`}>

          <EmptyState title="目前沒有錯題可以練習" />

        </div>

      </main>

    );

  }



  const currentQuestion =
    questions[currentIndex];



  const answer =
    currentQuestion.answer;





  function checkAnswer(){
    if (showResult || !selected) return;
    void sendStatistics([{ question_id: currentQuestion.id, selected_answer: selected }]);


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

      <main className={`${foundation.foundation} ${styles.page}`}>


        <div className={styles.state}>


          <h1 className={styles.question}>

            <StudyIcon name="target" /> 錯題複習完成

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


    <main className={`${foundation.foundation} ${styles.page}`}>


      <div className={`${styles.container} ${styles.card}`}>


        <p className={styles.meta}>

          錯題複習

          第 {currentIndex + 1}

          /

          {questions.length}

          題

        </p>




        <h1 className={styles.question}>

          {currentQuestion.question}

        </h1>





        <div className={styles.options} role="group" aria-label="答案選項">


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


              aria-pressed={selected === String.fromCharCode(65+index)}
              className={`${styles.option} ${selected === String.fromCharCode(65+index) ? styles.selected : ""}`}

            >

              <span className={styles.letter}>{String.fromCharCode(65+index)}.</span>

              <span className={styles.optionText}>{option}</span>


            </button>


            )

          )

        }


        </div>





        <button

          onClick={checkAnswer}

          className="study-button study-button-primary mt-6"

        >

          確認答案

        </button>






        {

          showResult && (

            <div className={styles.explanation} role="status">


              {

                selected === answer


                ?

                <p className={styles.correctText}>

                  ✓ 答對了

                </p>


                :

                <p className={styles.wrongText}>

                  ✗ 答錯了

                  正確答案：

                  {answer}

                </p>

              }




              <p className={styles.explanationText}>

                解析：

                {currentQuestion.explanation}

              </p>





              <button

                onClick={nextQuestion}

                className="study-button study-button-primary mt-5"

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