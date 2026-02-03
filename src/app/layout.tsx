import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'ProspectAI - Premium Donor Profiling',
  description: 'Behavioral intelligence for fundraising meetings',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white dark:bg-gray-950">
        {children}
      </body>
    </html>
  )
}
