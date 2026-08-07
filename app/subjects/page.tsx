"use client";

import Link from "next/link";


const subjects = [
  "獸醫病理學",
  "獸醫藥理學",
  "獸醫實驗診斷學",
  "獸醫普通疾病學",
  "獸醫傳染病學",
  "獸醫公共衛生學",
];


export default function SubjectsPage() {


  return (

    <main className="min-h-screen bg-gray-100 p-10">


      <div className="mx-auto max-w-5xl">


        <h1 className="text-4xl font-bold mb-8">

          📚 選擇科目

        </h1>




        <div className="grid gap-6 md:grid-cols-4">


          {

            subjects.map((subject)=>(


              <Link

                key={subject}

                href={`/questions?subject=${subject}`}

                className="rounded-xl bg-white p-8 shadow hover:bg-blue-600 hover:text-white transition"

              >

                <h2 className="text-xl font-bold">

                  {subject}

                </h2>


              </Link>


            ))

          }


        </div>


      </div>


    </main>


  );

}