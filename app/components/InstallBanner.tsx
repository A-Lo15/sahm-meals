'use client'

import { useState, useEffect } from 'react'

export default function InstallBanner() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
    const isStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
    const dismissed = localStorage.getItem('install-banner-dismissed')
    if (isIOS && !isStandalone && !dismissed) setShow(true)
  }, [])

  function dismiss() {
    localStorage.setItem('install-banner-dismissed', '1')
    setShow(false)
  }

  if (!show) return null

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 px-4 py-3 shadow-lg">
      <div className="max-w-lg mx-auto flex items-start gap-3">
        <div className="flex-1">
          <p className="text-sm font-semibold text-gray-900">Add to Home Screen</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Tap <span className="font-medium">Share</span> then{' '}
            <span className="font-medium">Add to Home Screen</span> for the full app experience.
          </p>
        </div>
        <button onClick={dismiss} className="text-gray-400 text-lg leading-none mt-0.5">
          ✕
        </button>
      </div>
    </div>
  )
}
