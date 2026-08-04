/** 封装后端 HTTP 请求和 WebSocket 连接，向 Model 提供传输能力。 */
export interface HttpTransport {
  request<T>(method: string, path: string, body?: unknown, timeoutMs?: number): Promise<T>;
}

export function createHttpTransport(baseUrl: string): HttpTransport {
  return {
    async request<T>(method: string, path: string, body?: unknown, timeoutMs?: number): Promise<T> {
      const init: RequestInit = {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      };
      if (timeoutMs) {
        const controller = new AbortController();
        init.signal = controller.signal;
        setTimeout(() => controller.abort(), timeoutMs);
      }
      const response = await fetch(`${baseUrl}${path}`, init);
      return response.json() as Promise<T>;
    },
  };
}

export interface WebSocketTransport {
  connect(url: string, handlers: {
    onMessage: (data: string) => void;
    onOpen?: () => void;
    onClose?: () => void;
    onError?: () => void;
  }): WebSocket;
}

export const webSocketTransport: WebSocketTransport = {
  connect(url, handlers): WebSocket {
    const socket = new WebSocket(url);
    socket.onmessage = event => handlers.onMessage(String(event.data));
    socket.onopen = () => handlers.onOpen?.();
    socket.onclose = () => handlers.onClose?.();
    socket.onerror = () => handlers.onError?.();
    return socket;
  },
};
