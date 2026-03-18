import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Domainsearch Naming Lab",
  description: "AI-powered brand name generation with live domain availability",
  icons: {
    icon: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <script
          dangerouslySetInnerHTML={{
            __html: `
(function() {
  var k = 'naming-lab-theme';
  try {
    var t = localStorage.getItem(k);
    var el = document.documentElement;
    if (t === 'dark') { el.classList.add('dark'); el.classList.remove('theme-light'); }
    else if (t === 'light') { el.classList.add('theme-light'); el.classList.remove('dark'); }
    else { el.classList.remove('dark', 'theme-light'); }
  } catch (e) {}
})();
            `.trim(),
          }}
        />
        {children}
      </body>
    </html>
  );
}
