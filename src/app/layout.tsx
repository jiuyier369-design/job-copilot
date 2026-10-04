import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Job Copilot",
  description: "个人 AI 求职决策与管理工具",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
