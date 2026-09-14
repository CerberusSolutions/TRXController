import { create } from 'zustand';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface ConnectionState {
  status: ConnectionStatus;
  port: string | null;
  setStatus: (status: ConnectionStatus) => void;
  setPort: (port: string | null) => void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  status: 'disconnected',
  port: null,
  setStatus: (status) => set({ status }),
  setPort: (port) => set({ port }),
}));
