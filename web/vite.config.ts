import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: true } } },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: { output: { manualChunks(id) {
      if (!id.includes('node_modules')) return;
      if (/[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) return 'react';
      if (/[\\/](echarts|zrender)[\\/]/.test(id)) return 'echarts';
      if (/recharts|d3-|victory/.test(id)) return 'charts';
      if (/react-markdown|remark|micromark|mdast|unified|hast/.test(id)) return 'markdown';
      if (/lucide-react/.test(id)) return 'icons';
    } } },
  },
});
