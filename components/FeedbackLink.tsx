"use client";

import Link from "next/link";

export default function FeedbackLink() {
  return <Link href="/feedback" className="fixed bottom-5 right-5 z-50 rounded-full bg-slate-900 px-4 py-3 text-sm font-bold text-white shadow-lg transition hover:bg-slate-700">💬 回報問題</Link>;
}
