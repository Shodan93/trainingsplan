import { describe, it, expect } from 'vitest'
import { parseHeartRate } from '../hr'

function dv(bytes: number[]) {
  return new DataView(new Uint8Array(bytes).buffer)
}

describe('parseHeartRate (BLE 0x2A37)', () => {
  it('liest 8-bit-Werte (Flag-Bit 0 = 0)', () => {
    expect(parseHeartRate(dv([0x00, 72]))).toBe(72)
    // mit Energy-Expended-Feld dahinter – interessiert uns nicht
    expect(parseHeartRate(dv([0x08, 145, 0x10, 0x00]))).toBe(145)
  })
  it('liest 16-bit-Werte little-endian (Flag-Bit 0 = 1)', () => {
    expect(parseHeartRate(dv([0x01, 0xb4, 0x00]))).toBe(180)
  })
  it('verwirft Unsinn', () => {
    expect(parseHeartRate(dv([0x00]))).toBeNull()          // zu kurz
    expect(parseHeartRate(dv([0x00, 0]))).toBeNull()       // 0 bpm
    expect(parseHeartRate(dv([0x01, 0xff, 0xff]))).toBeNull() // 65535 bpm
  })
})
