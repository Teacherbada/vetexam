"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { dailyGoal } from "@/data/tasks";

export default function Home() {

const [todayProgress, setTodayProgress] = useState(0);
const [progress, setProgress] = useState<any>({});
const [examDate, setExamDate] = useState("2027-07-31");


  useEffect(() => {

    const data =
      JSON.parse(
        localStorage.getItem("progress") || "{}"
      );


    setProgress(data);

const daily =
  JSON.parse(
    localStorage.getItem("dailyProgress") || "{}"
  );


const today =
  new Date().toISOString().split("T")[0];


setTodayProgress(
  daily[today]?.completed || 0
);
const savedExamDate =
  localStorage.getItem("examDate");

if (savedExamDate) {

  setExamDate(savedExamDate);

} else {

  localStorage.setItem(
    "examDate",
    "2027-07-31"
  );

}
  }, []);
const today = new Date();

const targetDate = new Date(examDate);

const diffTime =
  targetDate.getTime() - today.getTime();

const daysLeft = Math.max(
  0,
  Math.ceil(diffTime / (1000 * 60 * 60 * 24))
);



  const subjects = [
  "獸醫病理學",
  "獸醫藥理學",
  "獸醫實驗診斷學",
  "獸醫普通疾病學",
  "獸醫傳染病學",
  "獸醫公共衛生學",
];




  return (

    <main className="min-h-screen bg-gray-50 px-6 py-12">


      <div className="mx-auto max-w-5xl">



        <h1 className="text-5xl font-bold text-blue-900">

          VetExam

        </h1>



        <p className="mt-4 text-xl text-gray-600">

          獸醫國考 AI 學習平台

        </p>





        <section className="mt-10 rounded-2xl bg-white p-8 shadow">

  <div className="flex items-center justify-between">

    <h2 className="text-2xl font-bold">
      📅 距離獸醫師國考
    </h2>

    <input
      type="date"
      value={examDate}
      onChange={(e) => {

        setExamDate(e.target.value);

        localStorage.setItem(
          "examDate",
          e.target.value
        );

      }}
      className="rounded-lg border px-3 py-2"
    />

  </div>

  <p className="mt-6 text-6xl font-bold text-blue-600">

    {daysLeft} 天

  </p>

  <p className="mt-4 text-gray-500">

    考試日期：{examDate}

  </p>

</section>


<section className="mt-8 rounded-2xl bg-white p-8 shadow">

  <h2 className="text-2xl font-bold">
    🔥 今日任務
  </h2>

  <p className="mt-4 text-xl">
    完成：
    {todayProgress} / {dailyGoal.target} 題
  </p>


  <div className="mt-4 h-4 rounded-full bg-gray-200">

    <div
      className="h-4 rounded-full bg-blue-600"
      style={{
        width:
        `${Math.min(
          (todayProgress / dailyGoal.target) * 100,
          100
        )}%`
      }}
    />

  </div>


</section>


    






        <section className="mt-10 grid gap-6 md:grid-cols-2">



          <Link

            href="/subjects"

            className="rounded-xl bg-blue-600 p-8 text-white shadow hover:bg-blue-700"

          >

            <h2 className="text-2xl font-bold">

              📖 開始刷題

            </h2>


            <p className="mt-3">

              選擇科目開始練習

            </p>


          </Link>

<Link
  href="/pdf"
  className="rounded-xl bg-purple-600 p-8 text-white shadow hover:bg-purple-700"
>
  <h2 className="text-2xl font-bold">
    📄 PDF 自動出題
  </h2>

  <p className="mt-3">
    上傳 PDF，自動建立題目練習
  </p>
</Link>
<Link

href="/favorites"

className="rounded-xl bg-white p-8 shadow hover:bg-gray-100"

>

<h2 className="text-2xl font-bold">

⭐ 我的收藏

</h2>


<p className="mt-3">

查看重要題目

</p>


</Link>



          <Link

            href="/wrong"

            className="rounded-xl bg-white p-8 shadow hover:bg-gray-100"

          >

            <h2 className="text-2xl font-bold">

              📚 我的錯題本

            </h2>


            <p className="mt-3">

              複習你的弱點題目

            </p>


          </Link>


<Link

href="/analysis"

className="rounded-xl bg-white p-8 shadow hover:bg-gray-100"

>

<h2 className="text-2xl font-bold">

📊 弱點分析

</h2>


<p className="mt-3">

查看你的學習弱點

</p>


</Link>

        </section>








        <h2 className="mt-12 text-3xl font-bold">

          學習進度

        </h2>





        <section className="mt-6 grid gap-6 md:grid-cols-3">



          {

            subjects.map((subject)=>(


              <div

                key={subject}

                className="rounded-xl bg-white p-6 shadow"

              >



                <h3 className="text-xl font-bold">

                  {subject}

                </h3>




                <p className="mt-3">

                  完成：

                  {
                    progress[subject]
                    ?
                    progress[subject].answered.length
                    :
                    0
                  }

                  題

                </p>





                <p className="mt-2">

                  正確：

                  {
                    progress[subject]
                    ?
                    progress[subject].correct
                    :
                    0
                  }

                  題

                </p>






                <p className="mt-2">

                  錯題：

                  {
                    progress[subject]
                    ?
                    progress[subject].wrong
                    :
                    0
                  }

                  題

                </p>



              </div>


            ))

          }



        </section>




      </div>


    </main>


  );

}