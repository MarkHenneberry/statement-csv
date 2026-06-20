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
  "/pdf-bank-statement-to-csv",
  "/pdf-bank-statement-to-excel",
  "/bank-statement-parser",
  "/convert-rbc-bank-statement-to-csv",
  "/convert-td-bank-statement-to-csv",
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
