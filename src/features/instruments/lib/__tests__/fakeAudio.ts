/**
 * 测试用的最小 AudioContext 替身：统计节点创建与连接数，
 * 让「反复滚动 / 暂停恢复不累积节点」成为可断言的事实。
 */
class FakeParam {
  value = 0;
  events: { type: string; value: number; time: number }[] = [];
  setValueAtTime(value: number, time: number) {
    this.events.push({ type: "set", value, time });
    this.value = value;
    return this;
  }
  exponentialRampToValueAtTime(value: number, time: number) {
    this.events.push({ type: "ramp", value, time });
    this.value = value;
    return this;
  }
  cancelScheduledValues() {
    return this;
  }
}
class FakeNode {
  connected: FakeNode[] = [];
  disconnected = false;
  connect(node: FakeNode) {
    if (!this.connected.includes(node)) this.connected.push(node);
  }
  disconnect() {
    this.disconnected = true;
    this.connected = [];
  }
}
class FakeGain extends FakeNode {
  gain = new FakeParam();
}
class FakeFilter extends FakeNode {
  type = "";
  frequency = new FakeParam();
}
class FakeSource extends FakeNode {
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  start(_when: number) {
    this.started = true;
  }
  stop() {
    if (this.stopped) throw new Error("already stopped");
    this.stopped = true;
  }
}
class FakeOscillator extends FakeSource {
  type = "";
  frequency = new FakeParam();
}
class FakeBuffer {
  constructor(public length: number) {}
  getChannelData() {
    return new Float32Array(this.length);
  }
}
class FakeBufferSource extends FakeSource {
  buffer: FakeBuffer | null = null;
}

export class FakeAudioContext {
  currentTime = 0;
  sampleRate = 8000;
  state: "running" | "suspended" = "suspended";
  destination = new FakeNode();
  created = { gains: 0, oscillators: 0, sources: 0, buffers: 0, filters: 0 };
  live = new Set<FakeNode>();
  createGain() {
    this.created.gains++;
    const node = new FakeGain();
    this.live.add(node);
    return node;
  }
  createOscillator() {
    this.created.oscillators++;
    const node = new FakeOscillator();
    this.live.add(node);
    return node;
  }
  createBufferSource() {
    this.created.sources++;
    const node = new FakeBufferSource();
    this.live.add(node);
    return node;
  }
  createBiquadFilter() {
    this.created.filters++;
    return new FakeFilter();
  }
  createBuffer(_channels: number, length: number) {
    this.created.buffers++;
    return new FakeBuffer(length);
  }
  async resume() {
    this.state = "running";
  }
  async close() {
    this.state = "suspended";
  }
  /** 当前仍连接在图上、未被断开的声音节点数。 */
  connectedNodes() {
    let count = 0;
    for (const node of this.live) if (!node.disconnected) count++;
    return count;
  }
}

export const installFakeAudio = () => {
  const context = new FakeAudioContext();
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = function () {
    return context;
  };
  return context;
};
