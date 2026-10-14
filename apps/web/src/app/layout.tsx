import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Semi_Condensed, JetBrains_Mono } from "next/font/google";
import { brand } from "@archvision/config";
import "./globals.css";

/* Tipografia del sistema (ver DESIGN.md): Barlow para texto, Semi Condensed
 * para titulares y etiquetas, JetBrains Mono para medidas y cifras. */
const barlow = Barlow({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-barlow",
  display: "swap",
});

const barlowCondensed = Barlow_Semi_Condensed({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-barlow-condensed",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: `${brand.name} - ${brand.tagline}`,
    template: `%s | ${brand.name}`,
  },
  description: brand.subtitle,
  applicationName: brand.name,
  authors: [{ name: brand.company }],
  icons: {
    icon: [
      { url: "/logo.svg", type: "image/svg+xml" },
    ],
    shortcut: "/logo.svg",
    apple: "/logo.svg",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#0a0c10",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // El tema oscuro es el predeterminado del producto (herramienta de diseno).
  // La preferencia por usuario se aplicara desde el store de UI en Fase 2.
  return (
    <html
      lang="es"
      className={`dark ${barlow.variable} ${barlowCondensed.variable} ${jetbrains.variable}`}
    >
      <body className="min-h-screen bg-canvas text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
