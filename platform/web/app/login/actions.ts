"use server";

import { redirect } from "next/navigation";
import { createSession, destroySession, verifyCredentials } from "../../lib/auth";

export async function login(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!verifyCredentials(email, password)) {
    // uniform error, no enumeration (spec §11)
    redirect("/login?error=1");
  }
  await createSession(email.trim().toLowerCase());
  redirect("/dashboard");
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}
