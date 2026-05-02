import type { Metadata, Viewport } from 'next'
import './globals.css'
import RegisterSW from './components/RegisterSW'
import InstallBanner from './components/InstallBanner'

export const metadata: Metadata = {
  title: 'Meal Planner',
  description: 'Plan your week. Shop smart.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Meal Planner',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#16a34a',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        <InstallBanner />
        <RegisterSW />
      </body>
    </html>
  )
}
