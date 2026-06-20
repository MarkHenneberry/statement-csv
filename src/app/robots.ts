import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // The upload tool and developer pages are not content pages.
      disallow: ["/upload", "/dev"],
    },
    sitemap: `${siteConfig.url}/sitemap.xml`,
    host: siteConfig.url,
  };
}
