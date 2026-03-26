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
          borderRadius: '38px',
        }}
      >
        <span style={{ fontSize: 80, lineHeight: 1 }}>🛍️</span>
        <span
          style={{
            fontSize: 28,
            fontWeight: 'bold',
            color: 'white',
            marginTop: 8,
            letterSpacing: '-1px',
          }}
        >
          ML
        </span>
      </div>
    ),
    { width: 192, height: 192 }
  )
}
