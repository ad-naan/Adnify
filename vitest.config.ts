import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: [
      'src/**/*.{test,spec,property}.{ts,tsx}',
      'tests/**/*.{test,spec,property}.{ts,tsx}'
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.{test,spec,property}.{ts,tsx}', 'src/**/*.d.ts', 'tests/**/*']
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@main': path.resolve(__dirname, './src/main'),
      '@renderer': path.resolve(__dirname, './src/renderer'),
      '@shared': path.resolve(__dirname, './src/shared'),
      '@components': path.resolve(__dirname, './src/renderer/components'),
      '@features': path.resolve(__dirname, './src/renderer/features'),
      '@services': path.resolve(__dirname, './src/renderer/services'),
      '@store': path.resolve(__dirname, './src/renderer/store'),
      '@hooks': path.resolve(__dirname, './src/renderer/hooks'),
      '@utils': path.resolve(__dirname, './src/renderer/utils'),
      '@app-types': path.resolve(__dirname, './src/renderer/types'),
    }
  }
})
