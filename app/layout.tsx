import type { Metadata } from "next";
import "./globals.css";
import FeedbackLink from "@/components/FeedbackLink";
import AdminLink from "@/components/AdminLink";

export const metadata: Metadata = {
  title: "VetExam｜獸醫國考學習平台",
  description: "每一題的累積，都是成為更好獸醫的力量。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}<AdminLink /><FeedbackLink /></body>
    </html>
  );
}
