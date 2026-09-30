import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Crypto Paper Lab",
  description:
    "BTC and SOL paper-trading research with Jev and TradingView charts",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
