import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="entry-shell">
      <div className="entry-glow entry-glow-one" />
      <div className="entry-glow entry-glow-two" />
      <nav className="entry-nav">
        <Link href="/" className="entry-brand"><span className="entry-mark">S</span><span>SAMZY<span className="entry-brand-accent">TECHNOLOGY</span></span></Link>
        <span className="entry-secure"><i /> PRIVATE COMPANY PORTAL</span>
      </nav>
      <section className="entry-hero">
        <div className="entry-kicker"><span /> BUSINESS COMMAND CENTRE</div>
        <h1>Run your business.<br /><em>Think bigger.</em></h1>
        <p>Your central workspace for company operations, sales intelligence, client relationships and smarter decisions.</p>
        <Link href="/login" className="entry-cta">Enter Command Centre <span>↗</span></Link>
        <div className="entry-footnote"><span>⌑</span> Secure administrator access <b>·</b> Samzy Technology</div>
      </section>
      <footer className="entry-footer"><span>© {new Date().getFullYear()} Samzy Technology</span><span>BOLD IDEAS. SMART TECH. REAL OUTCOME.</span></footer>
    </main>
  );
}
