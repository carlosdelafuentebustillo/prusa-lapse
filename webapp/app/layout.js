import "./globals.css";

export const metadata = {
  title: "Prusa-lapse — Cinematic Timelapse Controller",
  description: "An open-source multi-camera cinematic timelapse controller for the Prusa MK4s using ESP32-CAM modules.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
