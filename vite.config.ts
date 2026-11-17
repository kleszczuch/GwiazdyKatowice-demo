import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// BASE_PATH: '/GwiazdyKatowice-demo/' on GitHub Pages, '/' on its own (sub)domain.
export default defineConfig({ base: process.env.BASE_PATH ?? '/', plugins: [react()] });
