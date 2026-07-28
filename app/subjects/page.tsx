"use client";

import Link from "next/link";


const subjects = [
  "犬內科",
  "貓科",
  "外科",
  "病理",
  "藥理",
  "微生物",
  "寄生蟲",
  "公共衛生",
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