'use client'

import dynamic from 'next/dynamic'

const DisplayClient = dynamic(() => import('./DisplayClient'), { ssr: false })

export default function DisplayPage() {
  return <DisplayClient />
}
