import type { DesktopBridge } from '../../shared/bridge';

declare global {
  interface Window {
    cueweave: DesktopBridge;
  }
}
