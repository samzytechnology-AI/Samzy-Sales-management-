"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("SAMZYTECHNOLOGY");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const result = await response.json();
      if (!response.ok || !result.session) throw new Error(result.error ?? "Login failed. Check your details.");
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !anon) throw new Error("Secure sign-in is not configured. Contact the administrator.");
      const supabase = createClient(url, anon);
      const { data, error: sessionError } = await supabase.auth.setSession({
        access_token: result.session.access_token,
        refresh_token: result.session.refresh_token,
      });
      if (sessionError || !data.session) throw new Error("A secure session could not be created. Please try again.");
      router.replace("/dashboard");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to sign in. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="entry-shell login-shell">
      <div className="entry-glow entry-glow-one" />
      <nav className="entry-nav">
        <Link href="/" className="entry-brand"><span className="entry-mark">S</span><span>SAMZY<span className="entry-brand-accent">TECHNOLOGY</span></span></Link>
        <Link href="/" className="entry-back">← Back to home</Link>
      </nav>
      <section className="login-card">
        <div className="login-icon">⌑</div>
        <div className="entry-kicker">ADMINISTRATOR ACCESS</div>
        <h1>Welcome back.</h1>
        <p>Sign in to your Samzy command centre.</p>
        <form onSubmit={submit}>
          <label htmlFor="username">Username</label>
          <input id="username" name="username" value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" required />
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="Enter your password" autoComplete="current-password" required />
          {error ? <div className="login-error" role="alert">{error}</div> : null}
          <button type="submit" disabled={busy || !username.trim() || !password}>{busy ? "Verifying access…" : "Login to Command Centre"} <span>↗</span></button>
        </form>
        <div className="login-security"><span>✓</span> Secure administrator sign-in</div>
      </section>
      <footer className="entry-footer"><span>© {new Date().getFullYear()} Samzy Technology</span><span>PRIVATE · AUTHORISED ACCESS ONLY</span></footer>
    </main>
  );
}
