import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { StoreProvider } from "@/lib/store";
import { TopNav } from "@/components/TopNav";
import { ToastHost } from "@/components/ToastHost";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-mono-jb",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "ClipForge",
  description: "Long recordings in. Short clips out.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable}`}>
      <body>
        <StoreProvider>
          <div className="app">
            <TopNav />
            {children}
            <ToastHost />
          </div>
        </StoreProvider>
      </body>
    </html>
  );
}
