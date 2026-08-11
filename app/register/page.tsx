"use client";

import { FormEvent, useState } from "react";
import { authClient } from "@/lib/auth-client";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] =
    useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function handleRegister(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setMessage("");

    if (password.length < 8) {
      setMessage("密碼至少需要 8 個字元");
      return;
    }

    if (password !== confirmPassword) {
      setMessage("兩次輸入的密碼不一致");
      return;
    }

    setLoading(true);

    try {
      const result = await authClient.signUp.email({
        name,
        email,
        password,
      });

      if (result.error) {
        setMessage(
          result.error.message || "註冊失敗"
        );
        return;
      }

      window.location.href = "/";
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "註冊時發生錯誤"
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
            建立 VetExam 帳號
          </h1>

          <p className="mt-2 text-gray-600">
            建立帳號後即可擁有自己的私人題庫。
          </p>

          <form
            onSubmit={handleRegister}
            className="mt-8 space-y-5"
          >
            <div>
              <label className="text-sm font-semibold text-gray-700">
                姓名
              </label>

              <input
                type="text"
                value={name}
                onChange={(event) =>
                  setName(event.target.value)
                }
                required
                autoComplete="name"
                className="mt-2 w-full rounded-lg border border-gray-300 p-3 text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                placeholder="你的名稱"
              />
            </div>

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
                autoComplete="new-password"
                className="mt-2 w-full rounded-lg border border-gray-300 p-3 text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                placeholder="至少 8 個字元"
              />
            </div>

            <div>
              <label className="text-sm font-semibold text-gray-700">
                確認密碼
              </label>

              <input
                type="password"
                value={confirmPassword}
                onChange={(event) =>
                  setConfirmPassword(event.target.value)
                }
                required
                minLength={8}
                autoComplete="new-password"
                className="mt-2 w-full rounded-lg border border-gray-300 p-3 text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                placeholder="再次輸入密碼"
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
              {loading ? "建立帳號中..." : "註冊"}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-gray-600">
              已經有帳號？
            </p>

            <a
              href="/login"
              className="mt-1 inline-block font-semibold text-blue-600 hover:text-blue-800"
            >
              返回登入
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}