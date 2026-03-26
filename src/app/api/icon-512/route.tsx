import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
          borderRadius: '102px',
        }}
      >
        <span style={{ fontSize: 220, lineHeight: 1 }}>🛍️</span>
        <span
          style={{
            fontSize: 80,
            fontWeight: 'bold',
            color: 'white',
            marginTop: 16,
            letterSpacing: '-3px',
          }}
        >
          ML
        </span>
      </div>
    ),
    { width: 512, height: 512 }
  )
}
