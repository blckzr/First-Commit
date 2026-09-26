/**
 * Downloading a PDF the API generates (§5.15, §5.16).
 *
 * **Not a plain `<a href>`.** The PDF endpoints need the session cookie, and the
 * API is on a different origin — a link would send the request without
 * credentials and come back 401. So it is fetched with `credentials: "include"`,
 * like every other call, and handed to the browser as a blob.
 *
 * The filename comes from `content-disposition`, which the API builds and
 * sanitises; nothing here parses anything the learner typed.
 */

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export async function downloadPdf(path: string, fallbackName: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, { credentials: "include" });
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? "That download isn't available."
        : "The download didn't start. Try again in a moment.",
    );
  }

  const blob = await res.blob();
  const disposition = res.headers.get("content-disposition") ?? "";
  const named = /filename="([^"\n]+)"/.exec(disposition)?.[1];

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = named ?? fallbackName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Freed on the next tick; revoking immediately cancels the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
