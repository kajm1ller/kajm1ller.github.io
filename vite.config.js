import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

// Basic Vite config: serve on port 8000 and optimize the Rapier dependency
// Include the wasm plugin so Vite can handle `.wasm` imports used by Rapier.
export default defineConfig({
  plugins: [wasm()],
  server: {
    port: 8000
  },
  optimizeDeps: {
    include: ['@dimforge/rapier3d']
  }
});
~