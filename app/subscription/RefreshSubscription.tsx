"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
export default function RefreshSubscription() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <button className="study-button" disabled={pending} onClick={() => startTransition(() => router.refresh())}>
    {pending ? "正在讀取會員狀態…" : "重新整理狀態"}
  </button>;
}
