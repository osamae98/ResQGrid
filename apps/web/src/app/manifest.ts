import type { MetadataRoute } from "next";

// PWA manifest for the responder view (§12.2). Offline-first service worker is Phase 2.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ResQGrid Responder",
    short_name: "ResQGrid",
    start_url: "/responder",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#1d3b8b",
    icons: [{ src: "/favicon.ico", sizes: "48x48", type: "image/x-icon" }],
  };
}
