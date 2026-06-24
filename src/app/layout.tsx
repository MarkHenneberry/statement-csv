import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { JsonLd } from "@/components/JsonLd";
import { organizationJsonLd } from "@/lib/structured-data";
import { siteConfig } from "@/lib/site";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const defaultTitle = "Canadian Bank Statement to CSV and Excel Converter";

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: defaultTitle,
    template: `%s | ${siteConfig.name}`,
  },
  description: siteConfig.description,
  applicationName: siteConfig.name,
  keywords: [
    "Canadian bank statement converter",
    "Canadian bank statement to CSV",
    "Canadian bank statement to Excel",
    "RBC statement to CSV",
    "TD statement to Excel",
    "BMO statement converter",
    "CIBC statement converter",
    "Scotiabank statement converter",
    "credit union statement converter",
    "Interac e-Transfer statement CSV",
    "Canadian credit card statement to CSV",
    "bookkeeping CSV export Canada",
  ],
  openGraph: {
    type: "website",
    siteName: siteConfig.name,
    title: defaultTitle,
    description: siteConfig.description,
    url: siteConfig.url,
  },
  twitter: {
    card: "summary",
    title: defaultTitle,
    description: siteConfig.description,
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="flex min-h-screen flex-col">
        <JsonLd data={organizationJsonLd()} />
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
