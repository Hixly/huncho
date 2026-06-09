import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { DUXY_CONFIG } from './config';

interface AssemblyAIMessage {
  type: string;
  text?: string;
  audio_start?: number;
  audio_end?: number;
  created?: string;
  id?: string;
  error?: string;
}

export class AssemblyAITranscriptionProvider extends EventEmitter {
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private tokenExpiry: number = 0;
  private isConnecting = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private partialTranscript = '';
  private sessionActive = false;

  async initialize(): Promise<void> {
    await this.refreshToken();
    await this.connect();
  }

  private async refreshToken(): Promise<void> {
    console.log('[AssemblyAI] Fetching streaming token...');
    const response = await fetch(`${DUXY_CONFIG.workerBaseURL}/transcribe-token`, {
      method: 'POST',
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`[AssemblyAI] Failed to get token: ${response.status} ${err}`);
    }

    const data = await response.json() as { token: string };
    this.token = data.token;
    // Token expires in 480s, refresh 60s early
    this.tokenExpiry = Date.now() + (DUXY_CONFIG.assemblyAITokenExpirySeconds - 60) * 1000;
    console.log('[AssemblyAI] Token acquired, expires in ~7 minutes');
  }

  private async connect(): Promise<void> {
    if (this.isConnecting) return;
    if (!this.token) {
      await this.refreshToken();
    }

    this.isConnecting = true;

    return new Promise((resolve, reject) => {
      const wsUrl = `wss://streaming.assemblyai.com/v3/ws?token=${this.token}&sample_rate=16000&encoding=pcm_s16le&speech_model=nano`;

      console.log('[AssemblyAI] Connecting to streaming WebSocket...');
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        this.isConnecting = false;
        console.log('[AssemblyAI] WebSocket connected');
        resolve();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const msg = JSON.parse(data.toString()) as AssemblyAIMessage;
          this.handleMessage(msg);
        } catch (e) {
          console.error('[AssemblyAI] Failed to parse message:', e);
        }
      });

      this.ws.on('error', (err) => {
        console.error('[AssemblyAI] WebSocket error:', err);
        this.isConnecting = false;
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
          reject(err);
        }
      });

      this.ws.on('close', (code, reason) => {
        console.log(`[AssemblyAI] WebSocket closed: ${code} ${reason}`);
        this.ws = null;
        this.isConnecting = false;

        // Auto-reconnect after 2 seconds if we had an active session
        if (this.sessionActive) {
          this.reconnectTimer = setTimeout(() => this.reconnect(), 2000);
        }
      });

      // Timeout if connection takes too long
      setTimeout(() => {
        if (this.isConnecting) {
          this.isConnecting = false;
          reject(new Error('[AssemblyAI] Connection timeout'));
        }
      }, 10000);
    });
  }

  private handleMessage(msg: AssemblyAIMessage): void {
    if (msg.type === 'PartialTranscript' && msg.text) {
      this.partialTranscript = msg.text;
      this.emit('transcriptPartial', msg.text);
    } else if (msg.type === 'FinalTranscript' && msg.text) {
      this.partialTranscript = '';
      this.emit('transcriptFinal', msg.text);
      console.log('[AssemblyAI] Final transcript:', msg.text);
    } else if (msg.type === 'error' || msg.error) {
      console.error('[AssemblyAI] Server error:', msg.error);
      this.emit('error', new Error(msg.error || 'Unknown AssemblyAI error'));
    }
  }

  private async reconnect(): Promise<void> {
    console.log('[AssemblyAI] Attempting reconnect...');
    try {
      // Refresh token if needed
      if (Date.now() >= this.tokenExpiry) {
        await this.refreshToken();
      }
      await this.connect();
    } catch (err) {
      console.error('[AssemblyAI] Reconnect failed:', err);
      // Try again in 5 seconds
      this.reconnectTimer = setTimeout(() => this.reconnect(), 5000);
    }
  }

  sendAudioChunk(pcm16Buffer: Buffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[AssemblyAI] Cannot send audio: WebSocket not connected');
      return;
    }

    // AssemblyAI v3 expects raw binary PCM16 audio
    this.ws.send(pcm16Buffer);
  }

  startSession(): void {
    this.sessionActive = true;
    this.partialTranscript = '';
    console.log('[AssemblyAI] Session started');
  }

  async endSession(): Promise<string> {
    this.sessionActive = false;

    // Send end-of-stream signal if supported
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: 'Terminate' }));
      } catch (e) {
        // Ignore
      }
    }

    // Return any partial transcript that hasn't been finalized
    const partial = this.partialTranscript;
    this.partialTranscript = '';
    console.log('[AssemblyAI] Session ended');
    return partial;
  }

  async ensureConnected(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (Date.now() >= this.tokenExpiry) {
        await this.refreshToken();
      }
      await this.connect();
    }
  }

  destroy(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    console.log('[AssemblyAI] Destroyed');
  }
}

