"use client";

import { FormEvent, useState } from "react";
import { authClient } from "@/lib/auth-client";
import foundation from "@/components/ui/foundation.module.css";
import layout from "@/components/ui/page-layout.module.css";
import PageHeader from "@/components/ui/PageHeader";


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
    <main className={`${foundation.foundation} ${layout.page}`}>
      <div className={layout.auth}>
        <div className={layout.authCard}>
          <PageHeader title="建立 VetExam 帳號" description="建立帳號後即可擁有自己的私人題庫。" />

          <form
            onSubmit={handleRegister}
            className={layout.form}
          >
            <div>
              <label htmlFor="register-name" className={layout.label}>
                姓名
              </label>

              <input
                id="register-name"
                type="text"
                value={name}
                onChange={(event) =>
                  setName(event.target.value)
                }
                required
                autoComplete="name"
                className={layout.input}
                placeholder="你的名稱"
              />
            </div>

            <div>
              <label htmlFor="register-email" className={layout.label}>
                Email
              </label>

              <input
                id="register-email"
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
              <label htmlFor="register-password" className={layout.label}>
                密碼
              </label>

              <input
                id="register-password"
                type="password"
                value={password}
                onChange={(event) =>
                  setPassword(event.target.value)
                }
                required
                minLength={8}
                autoComplete="new-password"
                className={layout.input}
                placeholder="至少 8 個字元"
              />
            </div>

            <div>
              <label htmlFor="register-confirmPassword" className={layout.label}>
                確認密碼
              </label>

              <input
                id="register-confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(event) =>
                  setConfirmPassword(event.target.value)
                }
                required
                minLength={8}
                autoComplete="new-password"
                className={layout.input}
                placeholder="再次輸入密碼"
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
              {loading ? "建立帳號中..." : "註冊"}
            </button>
          </form>

          <div className={layout.secondaryNav}>
            <p className="text-sm text-gray-600">
              已經有帳號？
            </p>

            <a
              href="/login"
              className={layout.secondaryLink}
            >
              返回登入
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}