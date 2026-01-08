import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { copyFileSync, readFileSync, writeFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Plugin to copy and process files for Chrome extension
function chromeExtensionPlugin() {
  return {
    name: 'chrome-extension',
    closeBundle() {
      const distDir = resolve(__dirname, 'dist');
      
      // Copy manifest.json
      copyFileSync(
        resolve(__dirname, 'manifest.json'),
        resolve(distDir, 'manifest.json')
      );
      
      // Fix popup.html - move from nested to root and fix paths
      const nestedHtml = resolve(distDir, 'src/popup/popup.html');
      let html = readFileSync(nestedHtml, 'utf-8');
      // Fix absolute paths to relative
      html = html.replace(/src="\/popup\.js"/g, 'src="popup.js"');
      html = html.replace(/href="\/popup\.css"/g, 'href="popup.css"');
      writeFileSync(resolve(distDir, 'popup.html'), html);
      
      console.log('✓ Chrome extension files prepared');
    }
  };
}

export default defineConfig({
  plugins: [chromeExtensionPlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/popup.html'),
        content: resolve(__dirname, 'src/content/extractor.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
      },
    },
  },
  publicDir: 'public',
});
