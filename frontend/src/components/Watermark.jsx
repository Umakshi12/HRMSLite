import { useMemo } from 'react'
import useStore from '../lib/store'

export default function Watermark() {
  const user = useStore((s) => s.user)
  const text = `${user?.login_id || 'user'} • ${new Date().toLocaleDateString()}`

  const items = useMemo(() => {
    const arr = []
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 6; col++) {
        arr.push({
          top: `${row * 14}%`,
          left: `${col * 20 - 5}%`,
          key: `${row}-${col}`,
        })
      }
    }
    return arr
  }, [])

  return (
    <div className="watermark-overlay">
      {items.map((pos) => (
        <span key={pos.key} className="watermark-text" style={{ top: pos.top, left: pos.left }}>
          {text}
        </span>
      ))}
    </div>
  )
}
