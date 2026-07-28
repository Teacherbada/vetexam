"use client";

import { useEffect, useState } from "react";
import { getFavorites } from "@/data/favorites";


export default function FavoritesPage(){


  const [favorites,setFavorites] = useState<any[]>([]);



  useEffect(()=>{


    setFavorites(
      getFavorites()
    );


  },[]);




  return(


    <main className="min-h-screen bg-gray-100 p-10">


      <div className="mx-auto max-w-4xl">


        <h1 className="mb-8 text-4xl font-bold">

          ⭐ 我的收藏題庫

        </h1>





        {
          favorites.length === 0 ?


          (

            <div className="rounded-xl bg-white p-8 shadow">

              目前沒有收藏題目

            </div>

          )


          :


          (

            <div className="space-y-6">


              {
                favorites.map(
                  (question,index)=>(


                  <div

                    key={question.id}

                    className="rounded-xl bg-white p-6 shadow"

                  >



                    <p className="font-bold text-blue-600">

                      {question.subject}

                    </p>




                    <h2 className="mt-3 text-xl font-bold">

                      {index + 1}. {question.question}

                    </h2>





                    <div className="mt-4">


                      {
                        question.options.map(
                          (option:string,i:number)=>(


                          <p key={option} className="mt-2">

                            {String.fromCharCode(65+i)}.
                            {option}

                          </p>


                          )

                        )

                      }


                    </div>





                    <div className="mt-5 rounded-lg bg-gray-100 p-4">


                      <p className="font-bold">

                        答案：

                        <span className="text-green-600">

                          {question.answer}

                        </span>

                      </p>



                      <p className="mt-2">

                        解析：

                        {question.explanation}

                      </p>


                    </div>



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