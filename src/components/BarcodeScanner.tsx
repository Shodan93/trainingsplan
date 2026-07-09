import { useEffect, useRef, useState } from 'react'

// Kamera-Barcode-Scanner: nativer BarcodeDetector (Android/Chrome),
// Fallback @zxing/browser (iOS/Safari). Wird nur bei Bedarf geladen.
export default function BarcodeScanner({ onDetect, onClose }: { onDetect: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const stopped = useRef(false)

  useEffect(() => {
    let stream: MediaStream | null = null
    let zxingControls: { stop: () => void } | null = null
    let raf = 0

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' }, audio: false
        })
        if (!videoRef.current) return
        videoRef.current.srcObject = stream
        await videoRef.current.play()

        const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector
        if (BD) {
          const detector = new BD({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] })
          const tick = async () => {
            if (stopped.current || !videoRef.current) return
            try {
              const codes = await detector.detect(videoRef.current)
              if (codes.length) { finish(codes[0].rawValue); return }
            } catch { /* Frame übersprungen */ }
            raf = window.setTimeout(tick, 180) as unknown as number
          }
          tick()
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/browser')
          const reader = new BrowserMultiFormatReader()
          zxingControls = await reader.decodeFromVideoElement(videoRef.current, (result) => {
            if (result && !stopped.current) finish(result.getText())
          }) as unknown as { stop: () => void }
        }
      } catch (e) {
        console.error(e)
        setError('Kamera nicht verfügbar. Bitte Kamera-Zugriff erlauben (HTTPS nötig).')
      }
    }

    function finish(code: string) {
      stopped.current = true
      cleanup()
      onDetect(code)
    }
    function cleanup() {
      if (raf) clearTimeout(raf)
      zxingControls?.stop?.()
      stream?.getTracks().forEach(t => t.stop())
    }

    start()
    return () => { stopped.current = true; cleanup() }
  }, [onDetect])

  return (
    <div className="fixed inset-0 z-[60] bg-black flex flex-col">
      <div className="flex items-center justify-between p-4 pt-safe">
        <p className="font-semibold text-white">Barcode scannen</p>
        <button className="btn-ghost !px-3 !py-1.5" onClick={onClose}>Schließen</button>
      </div>
      <div className="flex-1 relative overflow-hidden">
        <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline muted />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-64 h-40 border-2 border-white/70 rounded-2xl" />
        </div>
        {error && (
          <div className="absolute inset-x-4 bottom-8 card text-sm text-red-200 bg-danger/20 border-danger/30">{error}</div>
        )}
      </div>
      <p className="text-center text-xs text-white/50 p-4 pb-safe">EAN-Code des Produkts in den Rahmen halten</p>
    </div>
  )
}
