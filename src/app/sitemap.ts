import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/site";

// /upload is intentionally excluded — it is noindex until the parser and
// payment flow are production-ready.
const routes = [
  "/",
  "/pricing",
  "/privacy",
  "/security",
  "/faq",
  "/sample",
  "/bank-statement-to-csv",
  "/canadian-bank-statement-to-csv",
  "/compare-bank-statement-converters",
  "/help/how-to-convert-bank-statement-pdf-to-csv",
  "/blog/import-bank-statements-quickbooks",
  "/pdf-bank-statement-to-csv",
  "/pdf-bank-statement-to-excel",
  "/bank-statement-parser",
  "/convert-rbc-bank-statement-to-csv",
  "/convert-td-bank-statement-to-csv",
  "/convert-bmo-bank-statement-to-csv",
  "/convert-cibc-bank-statement-to-csv",
  "/convert-scotiabank-statement-to-csv",
  "/convert-credit-union-statement-to-csv-canada",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return routes.map((route) => ({
    url: `${siteConfig.url}${route === "/" ? "" : route}`,
    lastModified,
    changeFrequency: "weekly",
    priority: route === "/" ? 1 : 0.7,
  }));
}
