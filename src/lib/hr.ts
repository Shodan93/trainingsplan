// Herzfrequenz-Gurt/Armband (z. B. Coospo HW6) über Web Bluetooth:
// Standard Heart Rate Service (0x180D) / Measurement (0x2A37).
// Web Bluetooth gibt es in Chrome/Edge (Android & Desktop) – nicht in iOS-Safari.

// Minimale Typen – TypeScripts DOM-Lib enthält Web Bluetooth nicht
type BTCharacteristic = {
  startNotifications(): Promise<BTCharacteristic>
  stopNotifications(): Promise<BTCharacteristic>
  addEventListener(type: 'characteristicvaluechanged', cb: (ev: Event) => void): void
  value?: DataView
}
type BTService = { getCharacteristic(id: string): Promise<BTCharacteristic> }
type BTServer = {
  connect(): Promise<BTServer>
  getPrimaryService(id: string): Promise<BTService>
  disconnect(): void
  connected: boolean
}
type BTDevice = {
  name?: string
  gatt?: BTServer
  addEventListener(type: 'gattserverdisconnected', cb: () => void): void
  removeEventListener(type: 'gattserverdisconnected', cb: () => void): void
}
type BluetoothApi = { requestDevice(opts: { filters: { services: string[] }[]; optionalServices?: string[] }): Promise<BTDevice> }

export const bluetoothSupported = () =>
  typeof navigator !== 'undefined' && 'bluetooth' in navigator

// Herzfrequenz aus dem 2A37-Payload lesen (Flag-Bit 0: 8- vs. 16-bit-Wert)
export function parseHeartRate(dv: DataView): number | null {
  if (dv.byteLength < 2) return null
  const flags = dv.getUint8(0)
  const hr = (flags & 0x1) ? dv.getUint16(1, true) : dv.getUint8(1)
  return hr > 0 && hr < 250 ? hr : null
}

export type HrConnection = {
  deviceName: string
  disconnect: () => void
}

// Verbindet mit einem HR-Gerät und liefert laufend Werte über onHr.
// onDisconnect feuert bei Verbindungsabbruch (Gurt aus, außer Reichweite …).
export async function connectHeartRate(
  onHr: (bpm: number) => void,
  onDisconnect: () => void
): Promise<HrConnection> {
  const bt = (navigator as unknown as { bluetooth: BluetoothApi }).bluetooth
  const device = await bt.requestDevice({ filters: [{ services: ['heart_rate'] }] })
  if (!device.gatt) throw new Error('Gerät unterstützt kein GATT.')
  const server = await device.gatt.connect()
  const srv = await server.getPrimaryService('heart_rate')
  const ch = await srv.getCharacteristic('heart_rate_measurement')
  await ch.startNotifications()
  ch.addEventListener('characteristicvaluechanged', (ev: Event) => {
    const dv = (ev.target as unknown as { value?: DataView }).value
    if (!dv) return
    const bpm = parseHeartRate(dv)
    if (bpm != null) onHr(bpm)
  })
  device.addEventListener('gattserverdisconnected', onDisconnect)
  return {
    deviceName: device.name ?? 'HR-Sensor',
    disconnect: () => {
      try { device.removeEventListener('gattserverdisconnected', onDisconnect) } catch { /* ignore */ }
      try { device.gatt?.disconnect() } catch { /* ignore */ }
    }
  }
}
