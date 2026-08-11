"use client";

import { FormEvent, useState } from "react";
import { authClient } from "@/lib/auth-client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setLoading(true);
    setMessage("");

    try {
      const result = await authClient.signIn.email({
        email,
        password,
        rememberMe: true,
      });

      if (result.error) {
        setMessage(result.error.message || "登入失敗");
        return;
      }

      window.location.href = "/";
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "登入時發生錯誤"
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto max-w-md">
        <div className="rounded-2xl bg-white p-8 shadow">
          <h1 className="text-3xl font-bold text-blue-900">
            VetExam 登入
          </h1>

          <p className="mt-2 text-gray-600">
            登入後即可管理自己的私人題庫。
          </p>

          <form
            onSubmit={handleLogin}
            className="mt-8 space-y-5"
          >
            <div>
              <label className="text-sm font-semibold text-gray-700">
                Email
              </label>

              <input
                type="email"
                value={email}
                onChange={(event) =>
                  setEmail(event.target.value)
                }
                required
                autoComplete="email"
                className="mt-2 w-full rounded-lg border border-gray-300 p-3 text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label className="text-sm font-semibold text-gray-700">
                密碼
              </label>

              <input
                type="password"
                value={password}
                onChange={(event) =>
                  setPassword(event.target.value)
                }
                required
                minLength={8}
                autoComplete="current-password"
                className="mt-2 w-full rounded-lg border border-gray-300 p-3 text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                placeholder="至少 8 個字元"
              />
            </div>

            {message && (
              <div className="rounded-lg bg-red-50 p-4 text-sm font-semibold text-red-700">
                {message}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-blue-600 px-6 py-3 font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
            >
              {loading ? "登入中..." : "登入"}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-gray-600">
              還沒有帳號？
            </p>

            <a
              href="/register"
              className="mt-1 inline-block font-semibold text-blue-600 hover:text-blue-800"
            >
              建立 VetExam 帳號
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}