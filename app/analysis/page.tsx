"use client";

import { useEffect, useState } from "react";


export default function AnalysisPage(){


  const [progress,setProgress] = useState<any>({});



  useEffect(()=>{


    const data =
      JSON.parse(
        localStorage.getItem("progress") || "{}"
      );


    setProgress(data);


  },[]);





  const subjects = Object.keys(progress);




  return(


    <main className="min-h-screen bg-gray-100 p-10">


      <div className="mx-auto max-w-5xl">



        <h1 className="text-4xl font-bold">

          📊 我的弱點分析

        </h1>





        {
          subjects.length === 0 ?


          (

            <div className="mt-8 rounded-xl bg-white p-8 shadow">

              尚無答題紀錄

            </div>


          )


          :


          (

            <div className="mt-8 grid gap-6 md:grid-cols-3">


              {

                subjects.map((subject)=>(


                  <div

                    key={subject}

                    className="rounded-xl bg-white p-6 shadow"

                  >



                    <h2 className="text-2xl font-bold">

                      {subject}

                    </h2>




                    <p className="mt-4">

                      完成：

                      {progress[subject].answered.length}

                      題

                    </p>





                    <p className="mt-2">

                      答對：

                      {progress[subject].correct}

                      題

                    </p>





                    <p className="mt-2">

                      錯題：

                      {progress[subject].wrong}

                      題

                    </p>





                    <p className="mt-4 text-xl font-bold text-blue-600">


                      正確率：

                      {
                        Math.round(

                          (
                            progress[subject].correct /

                            progress[subject].answered.length

                          )

                          *

                          100

                        )

                      }

                      %


                    </p>




                  </div>


                ))

              }



            </div>


          )

        }



      </div>


    </main>


  );


}