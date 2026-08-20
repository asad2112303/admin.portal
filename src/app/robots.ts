import type { MetadataRoute } from "next";

/** Nothing here is public. Disallow everything, for every crawler. */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", disallow: "/" }] };
}
