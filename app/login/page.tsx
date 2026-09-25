"use client";

import { FormEvent, useState } from "react";
import { authClient } from "@/lib/auth-client";
import foundation from "@/components/ui/foundation.module.css";
import layout from "@/components/ui/page-layout.module.css";
import PageHeader from "@/components/ui/PageHeader";


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
    <main className={`${foundation.foundation} ${layout.page}`}>
      <div className={layout.auth}>
        <div className={layout.authCard}>
          <PageHeader title="VetExam 登入" description="登入後即可管理自己的私人題庫。" />

          <form
            onSubmit={handleLogin}
            className={layout.form}
          >
            <div>
              <label htmlFor="login-email" className={layout.label}>
                Email
              </label>

              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(event) =>
                  setEmail(event.target.value)
                }
                required
                autoComplete="email"
                className={layout.input}
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label htmlFor="login-password" className={layout.label}>
                密碼
              </label>

              <input
                id="login-password"
                type="password"
                value={password}
                onChange={(event) =>
                  setPassword(event.target.value)
                }
                required
                minLength={8}
                autoComplete="current-password"
                className={layout.input}
                placeholder="至少 8 個字元"
              />
            </div>

            {message && (
              <div role="alert" className={layout.error}>
                {message}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className={layout.submit}
            >
              {loading ? "登入中..." : "登入"}
            </button>
          </form>

          <div className={layout.secondaryNav}>
            <p className="text-sm text-gray-600">
              還沒有帳號？
            </p>

            <a
              href="/register"
              className={layout.secondaryLink}
            >
              建立 VetExam 帳號
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}