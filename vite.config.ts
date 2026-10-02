import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({mode}) => {
  const port=process.env.PORT||loadEnv(mode,process.cwd(),'PORT').PORT||'8787';
  const proxy={ '/api/audio': { target: `http://127.0.0.1:${port}`, changeOrigin: false } };
  return {
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port:5173,
    strictPort:true,
    proxy,
  },
  preview: {
    port:4173,
    strictPort:true,
    proxy,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'motion-vendor': ['motion/react'],
          'animation-vendor': ['gsap', 'gsap/ScrollTrigger'],
        },
      },
    },
  },
  };
});
