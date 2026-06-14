import type { Metadata } from "next";
import { Inter, Space_Grotesk, Orbitron } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
});

const orbitron = Orbitron({
  variable: "--font-brand",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DeepWatch — The Skyscanner for Prediction Markets",
  description:
    "Compare prediction market odds across DeepBook Predict, Polymarket, and Kalshi. Spot pricing gaps, trade with confidence.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${spaceGrotesk.variable} ${orbitron.variable} h-full antialiased`}>
        {children}
      </body>
    </html>
  );
}
