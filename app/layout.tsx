import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Image Studio",
  description: "A private image workspace for your team.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
