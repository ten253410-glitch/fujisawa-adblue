import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "藤沢 AdBlue | 受注・給液管理",
  description: "藤沢営業所専用 AdBlue受注・給液・請求管理",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
