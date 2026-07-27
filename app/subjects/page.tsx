import Link from "next/link";
export default function SubjectsPage() {
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

  return (
    <main className="min-h-screen bg-gray-100 p-10">
      <h1 className="mb-8 text-4xl font-bold">
        選擇科目
      </h1>

      <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
        {subjects.map((subject) => (
         <Link
    href="/questions"
            key={subject}
            className="rounded-xl bg-white p-8 shadow transition hover:bg-blue-600 hover:text-white"
          >
            {subject}
          </Link>
        ))}
      </div>
    </main>
  );
}