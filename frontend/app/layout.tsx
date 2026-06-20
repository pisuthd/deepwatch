import type { Metadata } from "next";
import { Inter, Space_Grotesk, Orbitron } from "next/font/google";
import "./globals.css";
import Providers from "./providers";

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
  title: "DeepWatch - The Intelligence Layer for DeepBook",
  description: "AI-powered trading terminal for DeepBook Spot, Margin, and Predict — with on-chain access control and AI insights.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return ( 
     <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${spaceGrotesk.variable} ${orbitron.variable} h-full antialiased`}> 
       <Providers> 
         {children} 
      </Providers>
      </body>
    </html>
  );
}