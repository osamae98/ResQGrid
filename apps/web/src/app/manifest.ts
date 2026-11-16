import type { MetadataRoute } from "next";

// PWA manifest for the responder view (§12.2). Offline-first service worker is Phase 2.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RescueGrid Responder",
    short_name: "RescueGrid",
    start_url: "/responder",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#1d3b8b",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
