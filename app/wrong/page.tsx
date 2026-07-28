"use client";

import { useEffect, useState } from "react";


export default function WrongPage(){


  const [wrongQuestions,setWrongQuestions] =
    useState<any[]>([]);



  useEffect(()=>{


    const data =
      JSON.parse(
        localStorage.getItem("wrongQuestions") || "[]"
      );


    setWrongQuestions(data);


  },[]);





  function saveNote(
    id:number,
    note:string
  ){


    const updated =
      wrongQuestions.map((question)=>{


        if(question.id === id){

          return {
            ...question,
            note
          };

        }


        return question;


      });



    setWrongQuestions(updated);



    localStorage.setItem(
      "wrongQuestions",
      JSON.stringify(updated)
    );


  }






  function removeWrong(id:number){


    const updated =
      wrongQuestions.filter(
        (question)=>question.id !== id
      );


    setWrongQuestions(updated);



    localStorage.setItem(
      "wrongQuestions",
      JSON.stringify(updated)
    );


  }






  return(


    <main className="min-h-screen bg-gray-100 p-10">


      <div className="mx-auto max-w-4xl">



        <h1 className="mb-8 text-4xl font-bold">

          📚 我的錯題本

        </h1>

<a

href="/wrong-test"

className="mb-6 inline-block rounded-lg bg-blue-600 px-6 py-3 text-white"

>

🔥 開始錯題複習

</a>



        {
          wrongQuestions.length === 0


          ?

          (

            <div className="rounded-xl bg-white p-8 shadow">

              目前沒有錯題 🎉

            </div>

          )


          :


          (

          <div className="space-y-6">


          {
            wrongQuestions.map(
              (question,index)=>(


              <div

                key={question.id}

                className="rounded-xl bg-white p-6 shadow"

              >



                <p className="font-bold text-blue-600">

                  {question.subject}

                </p>




                <h2 className="mt-3 text-xl font-bold">

                  {index+1}.
                  {question.question}

                </h2>





                <p className="mt-4">

                  你的答案：

                  <span className="font-bold text-red-600">

                    {question.userAnswer || "未紀錄"}

                  </span>

                </p>





                <p className="mt-2">

                  正確答案：

                  <span className="font-bold text-green-600">

                    {question.answer}

                  </span>

                </p>





                <div className="mt-4 rounded-lg bg-gray-100 p-4">


                  <p className="font-bold">

                    解析：

                  </p>


                  <p className="mt-2">

                    {question.explanation}

                  </p>


                </div>






                <div className="mt-5">


                  <p className="mb-2 font-bold">

                    📝 我的筆記

                  </p>



                  <textarea


                    defaultValue={
                      question.note || ""
                    }


                    onBlur={(e)=>{

                      saveNote(
                        question.id,
                        e.target.value
                      );

                    }}


                    placeholder="整理自己的理解、記憶技巧、臨床重點..."


                    className="h-32 w-full rounded-lg border p-3"


                  />



                </div>







                <button

                  onClick={()=>removeWrong(question.id)}

                  className="mt-5 rounded-lg bg-green-600 px-5 py-2 text-white"

                >

                  ✅ 已掌握，移除錯題

                </button>




              </div>


              )

            )

          }


          </div>

          )

        }



      </div>


    </main>


  );


}