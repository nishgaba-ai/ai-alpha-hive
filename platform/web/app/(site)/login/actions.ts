"use server";

import { redirect } from "next/navigation";
import {
  destroySession,
  loginUser,
  registerUser,
  requestPasswordReset,
  resetPassword,
} from "../../../lib/auth";

// The invite token rides along as a hidden field so a failed attempt keeps
// the link alive, and acceptance happens once, after credentials pass.
export async function login(formData: FormData): Promise<void> {
  const invite = String(formData.get("invite") ?? "").trim();
  const res = await loginUser(String(formData.get("email") ?? ""), String(formData.get("password") ?? ""), { inviteToken: invite || undefined });
  if (!res.ok) redirect("/login?error=" + encodeURIComponent(res.error) + (invite ? "&invite=" + encodeURIComponent(invite) : ""));
  if (res.invite) {
    const msg = res.invite.ok ? `You joined ${res.invite.orgName} as ${res.invite.role}.` : res.invite.error;
    redirect("/c?msg=" + encodeURIComponent(msg));
  }
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
  const invite = String(formData.get("invite") ?? "").trim();
  const q = invite ? "&invite=" + encodeURIComponent(invite) : "";
  if (!res.ok) redirect("/register?error=" + encodeURIComponent(res.error) + q);
  // The invite is accepted at first sign-in, so it survives email verification.
  redirect((res.needsVerification ? "/login?registered=1" : "/login?verified=1") + q);
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
