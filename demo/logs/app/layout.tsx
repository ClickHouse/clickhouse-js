import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "RowBinary Logs Demo",
  description:
    "Server-rendered ClickHouse log viewer decoded with @clickhouse/rowbinary.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
