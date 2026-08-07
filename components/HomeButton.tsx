import Link from "next/link";

export default function HomeButton() {

  return (

    <Link
      href="/"
      className="
      inline-block
      rounded-lg
      bg-blue-600
      px-5
      py-2
      text-white
      hover:bg-blue-700
      "
    >
      🏠 回首頁
    </Link>

  );

}