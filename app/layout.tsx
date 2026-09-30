import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Bitcoin Paper Lab",
  description:
    "Local Bitcoin paper-trading research with Jev and TradingView charts",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
