"use server";

import { redirect } from "next/navigation";
import {
  destroySession,
  loginUser,
  registerUser,
  requestPasswordReset,
  resetPassword,
} from "../../lib/auth";

export async function login(formData: FormData): Promise<void> {
  const res = await loginUser(String(formData.get("email") ?? ""), String(formData.get("password") ?? ""));
  if (!res.ok) redirect("/login?error=" + encodeURIComponent(res.error));
  redirect("/dashboard");
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}

export async function register(formData: FormData): Promise<void> {
  const res = await registerUser(
    String(formData.get("email") ?? ""),
    String(formData.get("password") ?? ""),
    String(formData.get("name") ?? ""),
  );
  if (!res.ok) redirect("/register?error=" + encodeURIComponent(res.error));
  redirect(res.needsVerification ? "/login?registered=1" : "/login?verified=1");
}

export async function forgot(formData: FormData): Promise<void> {
  await requestPasswordReset(String(formData.get("email") ?? ""));
  redirect("/forgot?sent=1"); // uniform regardless of account existence
}

export async function reset(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const err = await resetPassword(token, String(formData.get("password") ?? ""));
  if (err) redirect(`/reset?token=${encodeURIComponent(token)}&error=${encodeURIComponent(err)}`);
  redirect("/login?reset=1");
}
