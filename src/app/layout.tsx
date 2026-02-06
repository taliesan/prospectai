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
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=Instrument+Serif:ital@0;1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans min-h-screen">
        {children}
      </body>
    </html>
  )
}
