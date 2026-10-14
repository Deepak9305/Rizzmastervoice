export interface Recording { audio: string; mime: string; duration: number }
export class VoiceRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private started = 0;
  private generation = 0;
  async start(onComplete: (recording: Recording) => void, onError: (error: Error) => void) {
    this.cancel();
    const generation = this.generation;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Voice recording isn’t supported here. You can keep coaching by text.');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
    if (generation !== this.generation || document.hidden) { stream.getTracks().forEach(track => track.stop()); return false; }
    this.stream = stream;
    const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
    try { this.recorder = new MediaRecorder(this.stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 64000 }); }
    catch (error) { this.cancel(); throw error; }
    this.chunks = []; this.started = Date.now();
    this.recorder.ondataavailable = e => { if (e.data.size) this.chunks.push(e.data); };
    this.recorder.onerror = () => { this.cancel(); onError(new Error('The microphone stopped unexpectedly. Please try again.')); };
    this.recorder.onstop = async () => {
      const blob = new Blob(this.chunks, { type: this.recorder?.mimeType || 'audio/webm' });
      const duration = (Date.now() - this.started) / 1000;
      this.release(); this.chunks = [];
      if (blob.size < 400 || duration < 0.5) { onError(new Error('That was a little short. Hold the conversation for a second, then try again.')); return; }
      if (blob.size > 2 * 1024 * 1024) { onError(new Error('That recording was too large. Try a shorter message.')); return; }
      const reader = new FileReader();
      reader.onload = () => { if (generation === this.generation) onComplete({ audio: String(reader.result).split(',')[1], mime: blob.type.split(';')[0], duration }); };
      reader.onerror = () => onError(new Error('Could not read the recording. Please try again.'));
      reader.readAsDataURL(blob);
    };
    this.recorder.start(); this.timer = setTimeout(() => this.stop(), 45000);
    return true;
  }
  stop() { if (this.recorder?.state === 'recording') this.recorder.stop(); }
  cancel() { this.generation++; if (this.recorder) { this.recorder.onstop = null; this.recorder.ondataavailable = null; if (this.recorder.state === 'recording') this.recorder.stop(); } this.chunks = []; this.release(); }
  private release() { if (this.timer) clearTimeout(this.timer); this.timer = null; this.stream?.getTracks().forEach(track => track.stop()); this.stream = null; }
}
