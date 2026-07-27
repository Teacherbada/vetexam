export default function Home() {
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
          <h2 className="text-2xl font-bold">
            距離獸醫師國考
          </h2>

          <p className="mt-3 text-6xl font-bold text-blue-600">
            182 天
          </p>
        </section>


        <section className="mt-8 grid gap-6 md:grid-cols-3">

          <div className="rounded-xl bg-white p-6 shadow">
            <h3 className="text-xl font-bold">
              犬內科
            </h3>
            <p className="mt-2">
              今日進度 20 / 20
            </p>
          </div>


          <div className="rounded-xl bg-white p-6 shadow">
            <h3 className="text-xl font-bold">
              病理
            </h3>
            <p className="mt-2">
              今日進度 15 / 20
            </p>
          </div>


          <div className="rounded-xl bg-white p-6 shadow">
            <h3 className="text-xl font-bold">
              藥理
            </h3>
            <p className="mt-2">
              今日進度 10 / 20
            </p>
          </div>

        </section>


        <button className="mt-10 rounded-xl bg-blue-600 px-8 py-4 text-lg text-white">
          開始刷題
        </button>


      </div>
    </main>
  );
}