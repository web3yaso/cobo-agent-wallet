import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Citely Reader",
  description: "An x402 paid-report reading agent powered by Cobo Agentic Wallet.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
