// Email adapter: Postmark when POSTMARK_SERVER_TOKEN is set; otherwise the
// message is logged and `delivered` is false so flows degrade honestly
// (e.g. auto-verify at signup until a provider is configured).
export async function sendEmail(msg: {
  to: string;
  subject: string;
  text: string;
}): Promise<boolean> {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  const from = process.env.EMAIL_FROM ?? "no-reply@nishgaba.com";
  if (!token) {
    console.log(`[email:not-configured] to=${msg.to} subject=${msg.subject}\n${msg.text}`);
    return false;
  }
  const res = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": token,
    },
    body: JSON.stringify({ From: from, To: msg.to, Subject: msg.subject, TextBody: msg.text }),
  });
  return res.ok;
}

export const emailConfigured = (): boolean => Boolean(process.env.POSTMARK_SERVER_TOKEN);
