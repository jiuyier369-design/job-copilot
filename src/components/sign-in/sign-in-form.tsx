"use client";

import { useId, useRef, useState } from "react";
import type { SignInFormProps, SignInResult } from "@/types/sign-in";
import styles from "./sign-in-form.module.css";

/**
 * Sign-in form.
 *
 * Boundaries this component deliberately respects:
 * - It collects input and renders the outcome. It never calls fetch, Supabase, or
 *   any credential/token API, and it touches no cookie, localStorage or sessionStorage.
 * - It does not decide whether credentials are valid. That is the `onSubmit`
 *   result, so the real HTTP integration can be supplied by the host.
 * - No demo scenario or fixed result is hard-coded here; the host injects it.
 */

/**
 * A UX-only format check so an obvious typo does not cost a round trip.
 * It is deliberately permissive: real validation stays server-side and surfaces
 * as a 422 INVALID_INPUT / UNAUTHENTICATED result.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Shown when `onSubmit` rejects. A thrown error can carry internals, so the form
 * reports a generic retryable message instead of the exception text.
 */
const UNEXPECTED_FAILURE = "请求未能完成，请稍后重试。";

type FieldName = "email" | "password";

export function SignInForm({ onSubmit, onSuccess }: SignInFormProps) {
  const baseId = useId();
  const emailId = `${baseId}-email`;
  const passwordId = `${baseId}-password`;
  const failureId = `${baseId}-failure`;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [fieldError, setFieldError] = useState<{ field: FieldName; message: string } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const emailRef = useRef<HTMLInputElement | null>(null);
  const passwordRef = useRef<HTMLInputElement | null>(null);
  // Guards a second submit that arrives before React has re-rendered the button
  // into its disabled state.
  const pendingRef = useRef(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current) return;

    // The email is trimmed before it leaves the form; the password is passed
    // through exactly as typed, including any leading or trailing characters.
    const trimmedEmail = email.trim();

    if (trimmedEmail === "") {
      setFailure(null);
      setFieldError({ field: "email", message: "请输入邮箱。" });
      emailRef.current?.focus();
      return;
    }
    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setFailure(null);
      setFieldError({ field: "email", message: "邮箱格式不正确，请检查后重试。" });
      emailRef.current?.focus();
      return;
    }
    if (password === "") {
      setFailure(null);
      setFieldError({ field: "password", message: "请输入密码。" });
      passwordRef.current?.focus();
      return;
    }

    setFieldError(null);
    setFailure(null);
    pendingRef.current = true;
    setPending(true);

    let result: SignInResult;
    try {
      result = await onSubmit({ email: trimmedEmail, password });
    } catch {
      pendingRef.current = false;
      setPending(false);
      setFailure(UNEXPECTED_FAILURE);
      return;
    }

    pendingRef.current = false;
    setPending(false);

    if (result.ok) {
      // The secret is no longer needed once the host confirms the submission.
      setPassword("");
      onSuccess();
      return;
    }

    // The email is kept so a typo can be corrected and the request retried.
    setFailure(result.error.message);
  }

  /** Editing clears the previous outcome so a stale message cannot mislead. */
  function clearMessages() {
    setFieldError(null);
    setFailure(null);
  }

  // Narrowed per field so the render below can use the message without a cast.
  const emailError = fieldError?.field === "email" ? fieldError.message : null;
  const passwordError = fieldError?.field === "password" ? fieldError.message : null;

  return (
    // `noValidate` keeps the browser's native bubbles out of the way so the
    // in-form messages and focus handling below are the single source of truth.
    <form className={styles.form} onSubmit={handleSubmit} noValidate aria-busy={pending}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={emailId}>
          邮箱
        </label>
        <input
          ref={emailRef}
          id={emailId}
          className={styles.input}
          type="email"
          name="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            clearMessages();
          }}
          autoComplete="username"
          inputMode="email"
          disabled={pending}
          aria-invalid={emailError !== null || undefined}
          aria-describedby={emailError !== null ? `${emailId}-error` : undefined}
        />
        {emailError !== null ? (
          <p className={styles.fieldError} id={`${emailId}-error`} role="alert">
            {emailError}
          </p>
        ) : null}
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={passwordId}>
          密码
        </label>
        <input
          ref={passwordRef}
          id={passwordId}
          className={styles.input}
          type="password"
          name="password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            clearMessages();
          }}
          autoComplete="current-password"
          disabled={pending}
          aria-invalid={passwordError !== null || undefined}
          aria-describedby={passwordError !== null ? `${passwordId}-error` : undefined}
        />
        {passwordError !== null ? (
          <p className={styles.fieldError} id={`${passwordId}-error`} role="alert">
            {passwordError}
          </p>
        ) : null}
      </div>

      {failure ? (
        <div className={styles.failure} id={failureId} role="alert">
          {failure}
        </div>
      ) : null}

      <button type="submit" className={styles.submit} disabled={pending}>
        {pending ? "登录中…" : "登录"}
      </button>

      {/* Announced to assistive technology; the visible button label carries the same state. */}
      <p className={styles.srOnly} aria-live="polite">
        {pending ? "正在提交登录请求。" : ""}
      </p>
    </form>
  );
}
