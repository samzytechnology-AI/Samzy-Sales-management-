import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Samzy Business Command Centre", description: "The operating intelligence platform for Samzy Technology." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
