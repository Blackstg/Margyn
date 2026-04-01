interface IconProps {
  size?: number
}

export function MetaIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="6" fill="#1877F2" />
      <path
        d="M13.14 20v-7.27h2.44l.365-2.835H13.14V8.175c0-.82.228-1.38 1.407-1.38h1.504V4.24A20.1 20.1 0 0 0 13.87 4.1c-2.164 0-3.645 1.32-3.645 3.746V9.9H7.78v2.834h2.445V20h2.916Z"
        fill="white"
      />
    </svg>
  )
}

export function GoogleIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="6" fill="white" stroke="#e8e8e4" strokeWidth="1" />
      <path d="M21.8 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.49c-.24 1.27-.96 2.35-2.04 3.07v2.55h3.3c1.93-1.78 3.05-4.4 3.05-7.45z" fill="#4285F4"/>
      <path d="M12 22c2.76 0 5.08-.92 6.77-2.47l-3.3-2.55c-.92.62-2.09.98-3.47.98-2.67 0-4.93-1.8-5.74-4.22H2.9v2.63C4.58 19.83 8.04 22 12 22z" fill="#34A853"/>
      <path d="M6.26 13.74A5.87 5.87 0 0 1 5.93 12c0-.6.1-1.19.33-1.74V7.63H2.9A9.98 9.98 0 0 0 2 12c0 1.62.38 3.14 1.05 4.48l3.21-2.74z" fill="#FBBC05"/>
      <path d="M12 6.04c1.5 0 2.85.52 3.91 1.53l2.93-2.93C17.07 2.99 14.76 2 12 2 8.04 2 4.58 4.17 2.9 7.52l3.36 2.61C7.07 7.84 9.33 6.04 12 6.04z" fill="#EA4335"/>
    </svg>
  )
}

export function TikTokIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="6" fill="#010101" />
      <path
        d="M17.75 5.7a4.1 4.1 0 0 1-2.52-1.38A4.07 4.07 0 0 1 14.33 2h-2.8v13.36a2.03 2.03 0 0 1-2.04 1.73 2.04 2.04 0 0 1-2.04-2.04c0-1.13.91-2.04 2.04-2.04.2 0 .39.03.57.08V10.2a4.84 4.84 0 0 0-.57-.03 4.85 4.85 0 0 0-4.85 4.85A4.85 4.85 0 0 0 9.49 19.9a4.85 4.85 0 0 0 4.84-4.85V8.56a6.9 6.9 0 0 0 4.02 1.28V7.04a4.12 4.12 0 0 1-.6-.05V5.7z"
        fill="white"
      />
    </svg>
  )
}

export function PinterestIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="6" fill="#E60023" />
      <path
        d="M12 2C6.48 2 2 6.48 2 12c0 4.24 2.65 7.87 6.39 9.29-.09-.79-.17-2.01.04-2.87.18-.78 1.18-4.97 1.18-4.97s-.3-.6-.3-1.49c0-1.39.81-2.43 1.82-2.43.86 0 1.27.64 1.27 1.41 0 .86-.55 2.14-.83 3.33-.24 1 .5 1.81 1.49 1.81 1.78 0 3.15-1.88 3.15-4.59 0-2.4-1.72-4.08-4.19-4.08-2.85 0-4.52 2.14-4.52 4.35 0 .86.33 1.79.75 2.29a.3.3 0 0 1 .07.29l-.28 1.13c-.04.18-.15.22-.34.13-1.25-.58-2.03-2.41-2.03-3.88 0-3.16 2.3-6.06 6.62-6.06 3.48 0 6.18 2.48 6.18 5.79 0 3.45-2.18 6.23-5.2 6.23-1.02 0-1.97-.53-2.3-1.15l-.62 2.38c-.23.87-.84 1.96-1.25 2.63.94.29 1.94.45 2.97.45 5.52 0 10-4.48 10-10S17.52 2 12 2z"
        fill="white"
      />
    </svg>
  )
}

export function PlatformIcon({ platform, size = 16 }: { platform: string; size?: number }) {
  switch (platform) {
    case 'meta':      return <MetaIcon size={size} />
    case 'google':    return <GoogleIcon size={size} />
    case 'tiktok':    return <TikTokIcon size={size} />
    case 'pinterest': return <PinterestIcon size={size} />
    default:
      return (
        <span
          className="inline-flex items-center justify-center rounded text-white text-[9px] font-bold"
          style={{ width: size, height: size, background: '#6b6b63', fontSize: size * 0.55 }}
        >
          {platform[0]?.toUpperCase()}
        </span>
      )
  }
}
