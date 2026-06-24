// 用 WebAudio 合成白噪音/棕噪音/雨声, 零素材、零安装包体积。
export type NoiseKind = 'none' | 'white' | 'brown' | 'rain'

let ctx: AudioContext | null = null
let src: AudioBufferSourceNode | null = null
let gain: GainNode | null = null

function makeBuffer(audio: AudioContext, kind: NoiseKind): AudioBuffer {
  const len = audio.sampleRate * 2
  const buf = audio.createBuffer(1, len, audio.sampleRate)
  const d = buf.getChannelData(0)
  let last = 0
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1
    if (kind === 'brown' || kind === 'rain') {
      last = (last + 0.02 * w) / 1.02
      d[i] = last * 3.5
    } else {
      d[i] = w
    }
  }
  return buf
}

export function startNoise(kind: NoiseKind): void {
  stopNoise()
  if (kind === 'none') return
  try {
    ctx = ctx || new AudioContext()
    void ctx.resume()
    src = ctx.createBufferSource()
    src.buffer = makeBuffer(ctx, kind)
    src.loop = true
    gain = ctx.createGain()
    gain.gain.value = kind === 'rain' ? 0.22 : kind === 'brown' ? 0.16 : 0.1
    if (kind === 'rain') {
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 1400
      src.connect(lp)
      lp.connect(gain)
    } else {
      src.connect(gain)
    }
    gain.connect(ctx.destination)
    src.start()
  } catch {
    /* 音频不可用则忽略 */
  }
}

export function stopNoise(): void {
  try {
    src?.stop()
    src?.disconnect()
    gain?.disconnect()
  } catch {
    /* ignore */
  }
  src = null
  gain = null
  void ctx?.suspend()
}
