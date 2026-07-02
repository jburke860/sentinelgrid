import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });

const description =
  "Live demo of SentinelGrid, a local-first edge telemetry platform for climate-risk monitoring: 50 virtual sensor nodes across 9 US regions with anomaly scoring, incident response, and playback — simulated in your browser.";

export const metadata: Metadata = {
  metadataBase: new URL("https://sentinelgrid-two.vercel.app"),
  title: "SentinelGrid — Edge Telemetry Ops Console",
  description,
  openGraph: {
    title: "SentinelGrid — Edge Telemetry Ops Console",
    description,
    url: "/",
    siteName: "SentinelGrid",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "SentinelGrid operator dashboard" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "SentinelGrid — Edge Telemetry Ops Console",
    description,
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#eef2f6",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${mono.variable} font-sans antialiased`}>
        {children}
      </body>
    </html>
  );
}
